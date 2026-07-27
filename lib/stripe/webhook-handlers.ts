import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { NotificationService } from "@/lib/notifications/service";
import { isRoyalPalMetadata } from "@/lib/stripe/app-metadata";
import { MeetingService } from "@/lib/meet/service";
import { logger } from "@/lib/observability/logger";
import type { Database } from "@/types/database";

type AdminClient = ReturnType<typeof createAdminClient>;

// bookingId is the payment correlation key: it ties a Checkout Session, a
// PaymentIntent and the resulting booking together across separate events.
const log = logger.child({ component: "stripe-webhook" });

/**
 * Extracts the booking id ONLY from events this application owns.
 *
 * The Stripe account is shared with Lingora, and Stripe fans every subscribed
 * event type out to every webhook endpoint on the account — so this endpoint
 * receives Lingora's payment events too. Previously the sole separator was
 * "does this event carry a booking_id?", which is unsafe for a sibling
 * tutoring product that plausibly uses the same key: a foreign event would
 * reach markPaymentSucceeded and attempt to write a payments row for a
 * booking id that does not exist here (foreign-key violation, error noise,
 * and a real cross-contamination risk if the id spaces ever overlap).
 *
 * Requiring `app === "royalpal"` makes ownership explicit and fails closed:
 * untagged or unknown-app events are ignored.
 */
function bookingIdFromMetadata(metadata: Stripe.Metadata | null | undefined): string | null {
  if (!isRoyalPalMetadata(metadata)) return null;
  return metadata?.booking_id ?? null;
}

function extractPaymentIntentId(
  paymentIntent: string | Stripe.PaymentIntent | null,
): string | null {
  if (!paymentIntent) return null;
  return typeof paymentIntent === "string" ? paymentIntent : paymentIntent.id;
}

/**
 * Records a successful payment and confirms the booking, idempotently.
 *
 * Upserts on booking_id rather than requiring the payment row to already
 * exist: the row is normally inserted up front when checkout starts (see
 * lib/actions/booking.ts), but upserting here means a dropped network call
 * at that step can't leave the webhook with nothing to update — money
 * changed hands, so this path has to succeed regardless. checkoutSessionId
 * is only included in the write when known, so payment_intent.succeeded
 * (which doesn't carry it) can't null out a value checkout.session.completed
 * already recorded.
 */
async function markPaymentSucceeded(
  admin: AdminClient,
  params: {
    bookingId: string;
    paymentIntentId: string;
    checkoutSessionId?: string;
    amountCents: number;
    currency: string;
  },
): Promise<void> {
  const { data: existing } = await admin
    .from("payments")
    .select("status")
    .eq("booking_id", params.bookingId)
    .maybeSingle();

  if (existing?.status === "succeeded") {
    return;
  }

  const payload: Database["public"]["Tables"]["payments"]["Insert"] = {
    booking_id: params.bookingId,
    stripe_payment_intent_id: params.paymentIntentId,
    amount_cents: params.amountCents,
    currency: params.currency,
    status: "succeeded",
    paid_at: new Date().toISOString(),
    ...(params.checkoutSessionId ? { checkout_session_id: params.checkoutSessionId } : {}),
  };

  const { error: paymentError } = await admin
    .from("payments")
    .upsert(payload, { onConflict: "booking_id" });

  if (paymentError) {
    log.error("failed to record successful payment", paymentError, { bookingId: params.bookingId });
    return;
  }

  const { data: booking } = await admin
    .from("bookings")
    .select("status, student_id, tutor_id")
    .eq("id", params.bookingId)
    .maybeSingle();

  if (booking?.status === "pending_payment") {
    const { error: confirmError } = await admin
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", params.bookingId)
      .eq("status", "pending_payment");

    if (confirmError) {
      log.error("failed to confirm booking", confirmError, { bookingId: params.bookingId });
      return;
    }

    // Create the live classroom on the pending→confirmed transition only, so
    // duplicate webhook deliveries cannot mint a second Meet room. Never
    // throws: money is already captured, and MeetingService records a failed
    // status for a later retry rather than failing the payment.
    await MeetingService.createMeeting(params.bookingId);

    // Notify both parties — once, on the actual pending→confirmed transition.
    await NotificationService.emitMany([
      {
        userId: booking.student_id,
        type: "payment_succeeded",
        title: "Payment received",
        body: "Your lesson is confirmed.",
        data: { href: "/student/bookings" },
      },
      {
        userId: booking.tutor_id,
        type: "booking_confirmed",
        title: "New confirmed lesson",
        body: "A student just booked and paid for a lesson.",
        data: { href: "/tutor/bookings" },
      },
    ]);
  }
}

export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const bookingId = bookingIdFromMetadata(session.metadata);
  if (!bookingId) return;

  if (session.payment_status !== "paid") {
    // Delayed payment method (e.g. bank debit) still processing —
    // payment_intent.succeeded will confirm once it clears.
    return;
  }

  const paymentIntentId = extractPaymentIntentId(session.payment_intent);
  if (!paymentIntentId) {
    log.error("checkout.session.completed missing payment_intent", undefined, {
      bookingId,
      sessionId: session.id,
    });
    return;
  }

  await markPaymentSucceeded(createAdminClient(), {
    bookingId,
    paymentIntentId,
    checkoutSessionId: session.id,
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
  });
}

export async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
  const bookingId = bookingIdFromMetadata(paymentIntent.metadata);
  if (!bookingId) return;

  await markPaymentSucceeded(createAdminClient(), {
    bookingId,
    paymentIntentId: paymentIntent.id,
    amountCents: paymentIntent.amount,
    currency: paymentIntent.currency,
  });
}

/**
 * True if `current` is still the payment attempt the booking's payments
 * row points to. A retry (see retryBookingPayment in lib/actions/booking.ts)
 * replaces both ids on that row with a fresh Checkout Session/PaymentIntent,
 * so a stale failed/expired event for an abandoned earlier attempt can be
 * told apart from one for the attempt that's actually still live.
 */
async function isCurrentPaymentAttempt(
  admin: AdminClient,
  bookingId: string,
  current: { checkoutSessionId?: string; paymentIntentId?: string },
): Promise<boolean> {
  const { data: payment } = await admin
    .from("payments")
    .select("checkout_session_id, stripe_payment_intent_id, status")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (!payment || payment.status === "succeeded") return false;
  if (current.checkoutSessionId && payment.checkout_session_id !== current.checkoutSessionId)
    return false;
  if (current.paymentIntentId && payment.stripe_payment_intent_id !== current.paymentIntentId)
    return false;
  return true;
}

export async function handlePaymentIntentFailed(
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
  const bookingId = bookingIdFromMetadata(paymentIntent.metadata);
  if (!bookingId) return;

  const admin = createAdminClient();
  if (!(await isCurrentPaymentAttempt(admin, bookingId, { paymentIntentId: paymentIntent.id }))) {
    return;
  }

  const { error } = await admin
    .from("payments")
    .update({ status: "failed" })
    .eq("booking_id", bookingId)
    .eq("stripe_payment_intent_id", paymentIntent.id);

  if (error) {
    log.error("failed to record failed payment", error, {
      bookingId,
      paymentIntentId: paymentIntent.id,
    });
  }

  const { data: booking } = await admin
    .from("bookings")
    .select("student_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (booking) {
    await NotificationService.emit({
      userId: booking.student_id,
      type: "payment_failed",
      title: "Payment didn't go through",
      body: "Your card was declined. You can retry payment from your bookings.",
      data: { href: "/student/bookings" },
    });
  }
}

export async function handleCheckoutSessionExpired(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const bookingId = bookingIdFromMetadata(session.metadata);
  if (!bookingId) return;

  const admin = createAdminClient();
  if (!(await isCurrentPaymentAttempt(admin, bookingId, { checkoutSessionId: session.id }))) {
    return;
  }

  const { error: paymentError } = await admin
    .from("payments")
    .update({ status: "expired" })
    .eq("booking_id", bookingId)
    .eq("checkout_session_id", session.id);

  if (paymentError) {
    log.error("failed to record expired payment", paymentError, {
      bookingId,
      sessionId: session.id,
    });
  }

  // Only release the slot if the booking is still waiting on this exact
  // payment attempt — if it's already confirmed (paid via a retry session
  // before this stale expiry event arrived), leave it alone. Scoping the
  // update's WHERE clause to status = 'pending_payment' makes this check
  // atomic instead of a read-then-write race.
  const { error: cancelError } = await admin
    .from("bookings")
    .update({ status: "cancelled", cancellation_reason: "Payment session expired" })
    .eq("id", bookingId)
    .eq("status", "pending_payment");

  if (cancelError) {
    log.error("failed to cancel expired booking", cancelError, {
      bookingId,
      sessionId: session.id,
    });
  }
}
