import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type AdminClient = ReturnType<typeof createAdminClient>;

function bookingIdFromMetadata(metadata: Stripe.Metadata | null | undefined): string | null {
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
    console.error("[stripe webhook] failed to record successful payment", paymentError);
    return;
  }

  const { data: booking } = await admin
    .from("bookings")
    .select("status")
    .eq("id", params.bookingId)
    .maybeSingle();

  if (booking?.status === "pending_payment") {
    const { error: confirmError } = await admin
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", params.bookingId)
      .eq("status", "pending_payment");

    if (confirmError) {
      console.error("[stripe webhook] failed to confirm booking", confirmError);
    }
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
    console.error("[stripe webhook] checkout.session.completed missing payment_intent", session.id);
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
    console.error("[stripe webhook] failed to record failed payment", error);
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
    console.error("[stripe webhook] failed to record expired payment", paymentError);
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
    console.error("[stripe webhook] failed to cancel expired booking", cancelError);
  }
}
