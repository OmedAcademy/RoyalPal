import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { NotificationService } from "@/lib/notifications/service";
import { bookingIdFromTransferGroup, isRoyalPalMetadata } from "@/lib/stripe/app-metadata";
import { MeetingService } from "@/lib/meet/service";
import { logger } from "@/lib/observability/logger";
import type { Database, Json } from "@/types/database";

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
/**
 * Idempotency gate for the whole webhook route (called once per delivery,
 * before any event-type-specific handler runs).
 *
 * The payment handlers already have their own idempotency via unique
 * constraints and conditional updates on `payments`/`bookings`, but Connect
 * event types (account.updated, transfer.*, payout.*) have no natural
 * unique-constraint backstop of their own — this is that backstop,
 * generalized to every event type rather than reimplemented per handler.
 *
 * A row with `processed_at` already set means a *fully completed* prior
 * delivery — skip. A row that exists with `processed_at` still null means a
 * prior attempt was recorded but never finished (the process crashed, or the
 * handler threw) — reprocess rather than skip, since nothing actually
 * completed. Ledger write failures fail OPEN (log and still process): this
 * table is a defense-in-depth idempotency aid, not the source of truth, and
 * refusing to process a real payment/account event because a bookkeeping
 * insert failed would be the wrong trade-off.
 */
export async function shouldProcessEvent(event: Stripe.Event): Promise<boolean> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("stripe_events")
    .select("processed_at")
    .eq("id", event.id)
    .maybeSingle();

  if (existing?.processed_at) {
    log.info("duplicate event skipped", { stripeEventId: event.id, eventType: event.type });
    return false;
  }

  if (!existing) {
    const { error } = await admin.from("stripe_events").insert({
      id: event.id,
      type: event.type,
      payload: event as unknown as Json,
    });
    if (error) {
      log.error("failed to record stripe event", error, {
        stripeEventId: event.id,
        eventType: event.type,
      });
    }
  }

  return true;
}

/** Marks an event fully processed so a later duplicate delivery is skipped. */
export async function markEventProcessed(eventId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("stripe_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", eventId);

  if (error) {
    log.error("failed to mark stripe event processed", error, { stripeEventId: eventId });
  }
}

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

/**
 * Syncs tutor_profiles.stripe_charges_enabled from the connected Account's
 * actual Stripe-verified state. This is the ONLY thing that flips it —
 * onboarding's return_url redirect is not trusted for this, since a tutor
 * can land back on /tutor/payouts before Stripe has finished verifying
 * anything (or after abandoning onboarding entirely).
 *
 * Looked up by stripe_account_id rather than trusting metadata.tutor_id
 * alone: the account is looked up in our own table, so a mismatched or
 * stale metadata value can't retarget the write to the wrong row.
 */
export async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  if (!isRoyalPalMetadata(account.metadata)) return;

  const admin = createAdminClient();
  const { data: tutorProfile, error: lookupError } = await admin
    .from("tutor_profiles")
    .select("id, stripe_charges_enabled")
    .eq("stripe_account_id", account.id)
    .maybeSingle();

  if (lookupError) {
    log.error("failed to look up tutor for connect account", lookupError, {
      accountId: account.id,
    });
    return;
  }
  if (!tutorProfile) {
    log.error("account.updated for an account with no matching tutor", undefined, {
      accountId: account.id,
    });
    return;
  }

  const chargesEnabled = account.charges_enabled ?? false;
  if (chargesEnabled === tutorProfile.stripe_charges_enabled) {
    // No-op: account.updated fires repeatedly as onboarding progresses
    // (e.g. individual fields being verified) well before charges_enabled
    // itself changes value.
    return;
  }

  const { error: updateError } = await admin
    .from("tutor_profiles")
    .update({ stripe_charges_enabled: chargesEnabled })
    .eq("id", tutorProfile.id);

  if (updateError) {
    log.error("failed to sync stripe_charges_enabled", updateError, {
      tutorId: tutorProfile.id,
      accountId: account.id,
    });
    return;
  }

  if (chargesEnabled) {
    await NotificationService.emit({
      userId: tutorProfile.id,
      type: "payouts_enabled",
      title: "Payouts are active",
      body: "Your Stripe account is verified. You'll now receive payouts automatically after each paid lesson.",
      data: { href: "/tutor/payouts" },
    });
  }
}

/**
 * Syncs a Stripe-confirmed refund onto payments/bookings. This is the ONLY
 * place either row is marked refunded — lib/actions/admin.ts's
 * refundBooking only ever calls stripe.refunds.create and stops; a
 * successful API response means Stripe accepted the request, not that the
 * transfer reversal actually settled.
 *
 * Charge objects don't carry the app/platform/environment metadata (Stripe
 * does not copy PaymentIntent metadata onto the Charge, the same reason
 * Session metadata is explicitly re-set on payment_intent_data at checkout
 * time), so ownership can't be checked via isRoyalPalMetadata here. Instead
 * this looks the PaymentIntent up in our OWN payments table — a row that
 * only ever exists because it already passed that same metadata check when
 * the payment first succeeded — which is a strictly stronger guarantee:
 * a foreign (e.g. Lingora) charge simply has no matching row and is
 * ignored, the same fail-closed outcome as the metadata check elsewhere.
 */
export async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = extractPaymentIntentId(charge.payment_intent);
  if (!paymentIntentId) return;

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("booking_id, status")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (!payment) return; // Not one of ours — fails closed.
  if (payment.status === "refunded") return; // Already synced.

  const { error: paymentError } = await admin
    .from("payments")
    .update({ status: "refunded" })
    .eq("booking_id", payment.booking_id)
    .neq("status", "refunded");

  if (paymentError) {
    log.error("failed to record refunded payment", paymentError, {
      bookingId: payment.booking_id,
    });
    return;
  }

  const { data: booking } = await admin
    .from("bookings")
    .select("status, student_id, tutor_id")
    .eq("id", payment.booking_id)
    .maybeSingle();

  if (!booking) return;

  // The booking_status transition trigger only allows confirmed/completed
  // -> refunded. A booking already cancelled before the refund lands (a
  // paid lesson cancelled, then separately refunded) can't make this
  // transition — the payment row above is still correctly marked refunded
  // regardless, so the ledger stays accurate even if the booking's own
  // status can't follow. Logged, not thrown: this is a known, accepted
  // edge case, not a failure to alert on loudly.
  if (booking.status === "confirmed" || booking.status === "completed") {
    const { error: bookingError } = await admin
      .from("bookings")
      .update({ status: "refunded" })
      .eq("id", payment.booking_id)
      .neq("status", "refunded");

    if (bookingError) {
      log.error("failed to mark booking refunded", bookingError, {
        bookingId: payment.booking_id,
      });
      return;
    }
  }

  await NotificationService.emitMany([
    {
      userId: booking.student_id,
      type: "payment_refunded",
      title: "Refund issued",
      body: "Your payment for this lesson has been refunded.",
      data: { href: "/student/bookings" },
    },
    {
      userId: booking.tutor_id,
      type: "payment_refunded",
      title: "A lesson payment was refunded",
      body: "The payment for this lesson was refunded to the student.",
      data: { href: "/tutor/bookings" },
    },
  ]);
}

/**
 * Fans an operational alert out to every admin. Used for the money events
 * nobody may ever be blind to — a payout that failed, or a chargeback.
 *
 * Finding zero admins is itself logged as an error: it means a real money
 * problem just happened with no human subscribed to hear about it.
 */
async function notifyAdmins(
  admin: AdminClient,
  input: {
    type: "transfer_reversed" | "dispute_created";
    title: string;
    body: string;
    href: string;
  },
): Promise<void> {
  const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");

  if (!admins || admins.length === 0) {
    log.error("no admin to alert about a money event", undefined, { alertType: input.type });
    return;
  }

  await NotificationService.emitMany(
    admins.map((a) => ({
      userId: a.id,
      type: input.type,
      title: input.title,
      body: input.body,
      data: { href: input.href },
    })),
  );
}

/** Stripe expands `destination`/`charge` inconsistently; normalize to an id. */
function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * A transfer that already reached the tutor's connected account has been
 * pulled back.
 *
 * NOTE ON SCOPE: this handler exists in place of `transfer.failed`, which
 * does NOT exist in the Stripe API version this project pins
 * (2026-06-24.dahlia — the only transfer events are created/reversed/
 * updated, and Transfer carries no failure_code/failure_message). With
 * destination charges a transfer that *cannot* be made fails the charge
 * itself, surfacing as payment_intent.payment_failed, which is already
 * handled above. `transfer.reversed` is the remaining way money can leave
 * a tutor after a lesson was paid for, so it is the real version of the
 * blind spot this milestone set out to close.
 *
 * CHOSEN BEHAVIOUR:
 *
 *  • Expected reversals are recorded silently. Our own refund path
 *    (lib/stripe/refunds.ts) uses reverse_transfer, so every legitimate
 *    refund produces one of these events; alerting on those would be pure
 *    noise and would train admins to ignore the alert that matters. The
 *    two cases are told apart by payments.status already being 'refunded'.
 *  • An UNEXPECTED reversal — money left the tutor with no refund on
 *    record — alerts every admin and the tutor. That is either a Stripe
 *    risk action or a manual dashboard intervention, and it means the
 *    tutor has silently lost earnings they can see disappear.
 *  • Neither case cancels the booking or changes payments.status. The
 *    student's charge is a separate fact from where the tutor's share
 *    ended up, and conflating them would imply a refund is owed when the
 *    ledger says otherwise.
 *
 * Ownership is established by `destination` matching a tutor_profiles row
 * we already store — a transfer to a sibling product's connected account
 * has no matching tutor and is ignored. That check comes first, so a
 * foreign transfer can never reach a write or an alert.
 */
export async function handleTransferReversed(transfer: Stripe.Transfer): Promise<void> {
  const destination = stripeId(transfer.destination);
  if (!destination) return;

  const admin = createAdminClient();
  const { data: tutorProfile } = await admin
    .from("tutor_profiles")
    .select("id")
    .eq("stripe_account_id", destination)
    .maybeSingle();

  if (!tutorProfile) return; // Not one of our tutors — fails closed.

  const bookingId = bookingIdFromTransferGroup(transfer.transfer_group);

  // Alert even when the booking can't be resolved. Money left one of our
  // tutors; being unable to name the lesson is a reason to shout louder,
  // not to stay silent.
  if (!bookingId) {
    log.error("transfer reversed with no resolvable booking", undefined, {
      transferId: transfer.id,
      destination,
      tutorId: tutorProfile.id,
    });
    await notifyAdmins(admin, {
      type: "transfer_reversed",
      title: "Tutor payout reversed",
      body: `A payout to a tutor was reversed and could not be matched to a lesson. Stripe transfer ${transfer.id} needs manual review.`,
      href: "/admin/payments",
    });
    return;
  }

  const { data: payment } = await admin
    .from("payments")
    .select("booking_id, status, transfer_status, bookings(tutor_id)")
    .eq("booking_id", bookingId)
    .maybeSingle<{
      booking_id: string;
      status: string;
      transfer_status: string | null;
      bookings: { tutor_id: string } | null;
    }>();

  // Cross-check: transfer_group rides on a charge, but the destination
  // account does not. Requiring both to agree means a mismatched pair can
  // never write payout state onto an unrelated booking.
  if (!payment || payment.bookings?.tutor_id !== tutorProfile.id) {
    log.error("transfer reversed with a mismatched booking reference", undefined, {
      transferId: transfer.id,
      bookingId,
      tutorId: tutorProfile.id,
    });
    await notifyAdmins(admin, {
      type: "transfer_reversed",
      title: "Tutor payout reversed",
      body: `A payout to a tutor was reversed. Stripe transfer ${transfer.id} references a lesson that does not match the receiving account — needs manual review.`,
      href: "/admin/payments",
    });
    return;
  }

  if (payment.transfer_status === "reversed") return; // Already recorded.

  // A refund we issued is the expected cause; anything else is not.
  const expected = payment.status === "refunded";

  const { error: updateError } = await admin
    .from("payments")
    .update({
      stripe_transfer_id: transfer.id,
      transfer_status: "reversed",
      transfer_status_reason: expected ? "refund" : "reversed_outside_royalpal",
    })
    .eq("booking_id", bookingId);

  if (updateError) {
    // Throwing makes the route answer 500 so Stripe redelivers: an
    // unrecorded reversal is exactly the blind spot this handler exists to
    // prevent, so losing it silently is not acceptable.
    log.error("failed to record transfer reversal", updateError, {
      transferId: transfer.id,
      bookingId,
    });
    throw new Error(`Could not record transfer reversal for booking ${bookingId}`);
  }

  if (expected) return; // Our own refund — recorded, nothing to alert on.

  log.error("tutor payout reversed outside RoyalPal", undefined, {
    transferId: transfer.id,
    bookingId,
    tutorId: tutorProfile.id,
  });

  await notifyAdmins(admin, {
    type: "transfer_reversed",
    title: "Tutor payout reversed",
    body: "A lesson payout was pulled back from a tutor with no refund on record — likely a Stripe risk action or a manual dashboard reversal. The student's payment is unaffected. Needs investigation.",
    href: "/admin/payments",
  });

  await NotificationService.emit({
    userId: tutorProfile.id,
    type: "transfer_reversed",
    title: "A payout was reversed",
    body: "A lesson payout was returned from your account. We're looking into it — no action is needed from you yet.",
    data: { href: "/tutor/payouts" },
  });
}

/**
 * A student's bank is reversing a charge. Stripe immediately withdraws the
 * disputed amount plus a fee from the platform balance, whether or not the
 * dispute is eventually won.
 *
 * CHOSEN BEHAVIOUR (minimal, per the milestone's scope — record and alert,
 * never adjudicate):
 *
 *  • The dispute id and Stripe's own status are recorded on the payment, so
 *    a disputed lesson is queryable (payments_disputed_idx) instead of
 *    living only in the Stripe dashboard.
 *  • Every admin is alerted with the evidence deadline, because a dispute
 *    ignored past its due date is lost by default.
 *  • The transfer is deliberately NOT reversed and the tutor is deliberately
 *    NOT notified or debited. Clawing a payout back would move real money
 *    away from a tutor on the strength of an unadjudicated claim — the
 *    tutor may well have taught the lesson. Whether RoyalPal or the tutor
 *    absorbs a lost dispute is a business decision, not one to make
 *    implicitly inside a webhook handler.
 *  • The booking is left alone: a disputed payment does not mean the lesson
 *    didn't happen, and booking_status has no 'disputed' state to move to
 *    without changing the transition trigger.
 *
 * Ownership is established the same way as handleChargeRefunded: the
 * PaymentIntent must already exist in our payments table, which it only
 * does because it passed the app-metadata check when the payment first
 * succeeded. Charge objects carry no RoyalPal metadata of their own.
 */
export async function handleChargeDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const paymentIntentId = stripeId(dispute.payment_intent);
  if (!paymentIntentId) return;

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("booking_id, stripe_dispute_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (!payment) return; // Not one of ours — fails closed.
  if (payment.stripe_dispute_id === dispute.id) return; // Already recorded.

  const { error: updateError } = await admin
    .from("payments")
    .update({ stripe_dispute_id: dispute.id, dispute_status: dispute.status })
    .eq("booking_id", payment.booking_id);

  if (updateError) {
    log.error("failed to record dispute", updateError, {
      disputeId: dispute.id,
      bookingId: payment.booking_id,
    });
    throw new Error(`Could not record dispute for booking ${payment.booking_id}`);
  }

  const dueBy = dispute.evidence_details?.due_by
    ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
    : null;

  log.error("chargeback opened", undefined, {
    disputeId: dispute.id,
    bookingId: payment.booking_id,
    amountCents: dispute.amount,
    reason: dispute.reason,
    dueBy,
  });

  await notifyAdmins(admin, {
    type: "dispute_created",
    title: "Chargeback opened",
    body: `A student disputed a lesson payment (${dispute.reason}). Stripe has already withdrawn the amount from the platform balance.${
      dueBy ? ` Evidence is due by ${dueBy.slice(0, 10)}.` : ""
    } Respond in the Stripe dashboard.`,
    href: "/admin/payments",
  });
}
