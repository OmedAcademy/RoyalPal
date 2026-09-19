"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { activeUserOrError } from "@/lib/supabase/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTutorAvailableSlots } from "@/lib/supabase/availability";
import { createBookingCheckoutSession } from "@/lib/stripe/checkout";
import { isStripeConfigured } from "@/lib/stripe/client";
import {
  createBookingSchema,
  retryBookingPaymentSchema,
  cancelBookingSchema,
  rescheduleBookingSchema,
} from "@/lib/validations/booking";
import { NotificationService } from "@/lib/notifications/service";
import { MeetingService } from "@/lib/meet/service";
import { ensureConversationForBooking } from "@/lib/messaging/service";
import { logger } from "@/lib/observability/logger";
import { platformFeeCents, resolvePlatformFeeBps } from "@/lib/pricing/commission";
import {
  resolveCancellation,
  isCancellable,
  FREE_CANCELLATION_HOURS,
} from "@/lib/booking/cancellation-policy";
import { refundBookingPayment } from "@/lib/stripe/refunds";
import { consumeRateLimit, rateLimitMessage } from "@/lib/rate-limit/limiter";
import type { Database } from "@/types/database";

export type BookingActionState = {
  error?: string;
  message?: string;
};

const log = logger.child({ component: "booking-action" });

const EXCLUSION_VIOLATION = "23P01";

/**
 * Minimum notice, in hours, to MOVE a lesson rather than cancel it.
 *
 * Deliberately equal to the free-cancellation window. If it were shorter,
 * moving a lesson to a distant date and cancelling it there would be a
 * free-refund loophole that walks straight around the cancellation policy.
 */
const RESCHEDULE_MIN_NOTICE_HOURS = FREE_CANCELLATION_HOURS;

/**
 * Creates the Stripe Checkout Session for a booking and records the
 * payment attempt, shared by createBooking (new booking) and
 * retryBookingPayment (an existing pending_payment booking whose previous
 * attempt failed or expired) so the two flows can't drift apart.
 */
async function startCheckout(
  supabase: SupabaseClient<Database>,
  booking: {
    id: string;
    tutor_id: string;
    student_id: string;
    subject_id: number;
    lesson_duration_minutes: number;
    price_cents: number;
    platform_fee_cents: number;
    currency: string;
  },
): Promise<string> {
  const lessonType = booking.lesson_duration_minutes === 30 ? "trial" : "standard";

  const [{ data: subject }, { data: tutor }, { data: tutorProfile }] = await Promise.all([
    supabase.from("subjects").select("name").eq("id", booking.subject_id).single(),
    supabase.from("profiles").select("full_name").eq("id", booking.tutor_id).single(),
    // Service role: 0041 withholds stripe_account_id from `authenticated`,
    // because a student who can see a tutor's headline must not also be able
    // to read their connected-account id. The booking row this reads from has
    // already been created and authorized for this student.
    createAdminClient()
      .from("tutor_profiles")
      .select("stripe_account_id")
      .eq("id", booking.tutor_id)
      .maybeSingle(),
  ]);

  const session = await createBookingCheckoutSession({
    bookingId: booking.id,
    tutorId: booking.tutor_id,
    studentId: booking.student_id,
    subjectId: booking.subject_id,
    lessonType,
    durationMinutes: booking.lesson_duration_minutes,
    priceCents: booking.price_cents,
    currency: booking.currency,
    subjectName: subject?.name ?? "Lesson",
    tutorName: tutor?.full_name ?? "your tutor",
    platformFeeCents: booking.platform_fee_cents,
    tutorStripeAccountId: tutorProfile?.stripe_account_id ?? null,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a Checkout URL");
  }

  // Written via the admin client because payments has no client-facing
  // insert/update policy (see supabase/migrations/0007_payments.sql) — this
  // is the same trust boundary as the webhook handler, just triggered from
  // a Server Action instead of an inbound Stripe event.
  //
  // NEVER a blind upsert. A plain upsert on booking_id unconditionally set
  // status='requires_payment', paid_at=null, which silently downgraded an
  // already-`succeeded` row whenever the webhook for the previous session
  // landed during this function's Stripe round trip — leaving a confirmed,
  // paid booking whose ledger row claimed it was unpaid.
  // The `.neq("status", "succeeded")` makes the guard atomic in the database
  // rather than a check-then-act in application code.
  // Regression coverage: lib/actions/payment-race.test.ts.
  const attempt = {
    booking_id: booking.id,
    checkout_session_id: session.id,
    // Null until the customer pays: Checkout Sessions don't create their
    // PaymentIntent until payment is submitted, so it can't be known here.
    // The webhook records the real id on payment_intent.succeeded /
    // checkout.session.completed.
    stripe_payment_intent_id:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? null),
    amount_cents: booking.price_cents,
    currency: booking.currency,
    status: "requires_payment" as const,
    paid_at: null,
  };

  const admin = createAdminClient();
  const { data: updated, error: updateError } = await admin
    .from("payments")
    .update(attempt)
    .eq("booking_id", booking.id)
    .neq("status", "succeeded")
    .select("id");

  if (updateError) {
    log.error("failed to update payment attempt", updateError, { bookingId: booking.id });
  }

  // No row updated: either none exists yet, or the existing row is already
  // succeeded and must be left alone. Insert only in the former case.
  if (!updated || updated.length === 0) {
    const { data: existing } = await admin
      .from("payments")
      .select("id")
      .eq("booking_id", booking.id)
      .maybeSingle();

    if (!existing) {
      const { error: insertError } = await admin.from("payments").insert(attempt);
      if (insertError) {
        // Non-fatal: the webhook upserts this same row when the payment
        // succeeds, so a dropped write here doesn't lose the payment record.
        log.error("failed to record payment attempt", insertError, { bookingId: booking.id });
      }
    }
  }

  return session.url;
}

export async function createBooking(
  _prevState: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const parsed = createBookingSchema.safeParse({
    tutorId: formData.get("tutorId"),
    subjectId: formData.get("subjectId"),
    startAt: formData.get("startAt"),
    durationMinutes: formData.get("durationMinutes"),
    lessonType: formData.get("lessonType"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { tutorId, subjectId, startAt, durationMinutes, lessonType } = parsed.data;

  if ((lessonType === "trial") !== (durationMinutes === 30)) {
    return { error: "Trial lessons are 30 minutes; standard lessons are 60 minutes" };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) {
    return { error: auth.error };
  }
  const user = auth.user;

  const createLimit = await consumeRateLimit("createBooking", user.id);
  if (!createLimit.allowed) return { error: rateLimitMessage(createLimit) };

  // Every lesson is paid, so an unconfigured Stripe makes booking
  // impossible. Refuse up front rather than creating a booking row and
  // immediately cancelling it when checkout fails.
  if (!isStripeConfigured()) {
    return { error: "Booking is temporarily unavailable. Please try again later." };
  }

  // Service role, because platform_fee_bps is the tutor's negotiated
  // commission rate and 0041 withholds it from `authenticated` — a student
  // booking a lesson has no business reading what the platform charges that
  // tutor, and neither does a competing tutor.
  //
  // Bypassing RLS costs nothing here: the policy this replaces admitted the
  // row only when the tutor was approved, and the very next line refuses
  // anything that is not approved. The check below IS the authorization, and
  // it is strictly the same condition.
  const { data: tutorProfile } = await createAdminClient()
    .from("tutor_profiles")
    .select(
      "hourly_rate_cents, trial_price_cents, currency, verification_status, stripe_charges_enabled, platform_fee_bps",
    )
    .eq("id", tutorId)
    .maybeSingle();

  if (!tutorProfile || tutorProfile.verification_status !== "approved") {
    return { error: "This tutor is not available for booking" };
  }

  // Paid (standard) bookings require the tutor to have completed Stripe
  // Connect onboarding — otherwise there's nowhere for their share of the
  // charge to go. Trial lessons are deliberately exempt (locked product
  // decision): they stay bookable so a student can still try a tutor while
  // onboarding is pending. stripe_charges_enabled is read from OUR OWN
  // tutor_profiles row keyed by tutorId — never inferable from client
  // input — and is set exclusively by the account.updated webhook
  // (lib/stripe/webhook-handlers.ts), never by anything client-facing.
  if (lessonType === "standard" && !tutorProfile.stripe_charges_enabled) {
    return {
      error:
        "This tutor is not yet accepting payments. Try booking a trial lesson instead, or check back soon.",
    };
  }

  if (lessonType === "trial" && tutorProfile.trial_price_cents === null) {
    return { error: "This tutor does not offer trial lessons" };
  }

  const { data: subjectMatch } = await supabase
    .from("tutor_subjects")
    .select("subject_id")
    .eq("tutor_id", tutorId)
    .eq("subject_id", subjectId)
    .maybeSingle();

  if (!subjectMatch) {
    return { error: "This tutor does not teach that subject" };
  }

  // The insert below runs through the service role (migration 0029 removed the
  // client INSERT path), so what a database policy used to take on trust is
  // checked here: the caller must be a student, and startAt — a hidden form
  // field, so client input like any other — must be one of the tutor's open
  // slots.
  const { data: caller } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (caller?.role !== "student") {
    return { error: "Only students can book lessons" };
  }

  const startDate = new Date(startAt);
  if (startDate.getTime() <= Date.now()) {
    return { error: "Pick a time in the future" };
  }
  const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);

  // Same timezone fallback as the booking page, so both see the same slots.
  const { data: tutorAccount } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", tutorId)
    .maybeSingle();
  const slots = await getTutorAvailableSlots({
    tutorId,
    timeZone: tutorAccount?.timezone ?? "UTC",
    durationMinutes,
  });
  if (!slots.some((slot) => slot.startAt.getTime() === startDate.getTime())) {
    return { error: "That time isn't one of this tutor's open slots. Please pick another." };
  }

  // Price is always derived server-side from the tutor's stored rate, never
  // from client input — the form only ever sends tutorId/subjectId/time.
  const priceCents =
    lessonType === "trial" ? tutorProfile.trial_price_cents! : tutorProfile.hourly_rate_cents;
  // Commission is resolved server-side per booking: the tutor's negotiated
  // rate if they have one, else the deployment rate, else the product
  // default. Snapshotted onto the booking row so a later rate change never
  // retroactively alters what an already-agreed lesson paid out.
  const feeCents = platformFeeCents(
    priceCents,
    resolvePlatformFeeBps(tutorProfile.platform_fee_bps),
  );

  const { data: booking, error: insertError } = await createAdminClient()
    .from("bookings")
    .insert({
      student_id: user.id,
      tutor_id: tutorId,
      subject_id: subjectId,
      start_at: startDate.toISOString(),
      end_at: endDate.toISOString(),
      lesson_duration_minutes: durationMinutes,
      price_cents: priceCents,
      platform_fee_cents: feeCents,
      currency: tutorProfile.currency,
    })
    .select(
      "id, tutor_id, student_id, subject_id, lesson_duration_minutes, price_cents, platform_fee_cents, currency",
    )
    .single();

  if (insertError) {
    if (insertError.code === EXCLUSION_VIOLATION) {
      return { error: "That time was just booked by someone else — pick another slot." };
    }
    // Anything else is logged, never shown raw. The refusal a real user can hit
    // is migration 0029's insert invariant (42501): the tutor changed their
    // rate between the read above and this insert.
    log.error("failed to insert booking", insertError, { tutorId, studentId: user.id });
    if (insertError.code === "42501") {
      return {
        error: "This tutor's price changed while you were booking. Please refresh and try again.",
      };
    }
    return { error: "We couldn't create your booking. Please try again." };
  }

  // Booking stays 'pending_payment' (the column default) until the Stripe
  // webhook confirms payment succeeded — see lib/stripe/webhook-handlers.ts.
  let checkoutUrl: string;
  try {
    checkoutUrl = await startCheckout(supabase, booking);
  } catch (err) {
    // Checkout couldn't be started — release the slot immediately rather
    // than leaving a dead pending_payment booking blocking it. Allowed by
    // the booking_status transition trigger: a student may always cancel
    // their own pending_payment booking.
    await supabase
      .from("bookings")
      .update({ status: "cancelled", cancellation_reason: "Payment setup failed" })
      .eq("id", booking.id);
    log.error("failed to start checkout", err, { bookingId: booking.id });
    return { error: "We couldn't start checkout. Please try again." };
  }

  // Open the thread as soon as the booking exists, not when it is paid: a
  // student whose payment is pending may well need to ask the tutor something
  // first, and a conversation that only appears after checkout is a
  // conversation nobody has when they need it. Best-effort by contract — a
  // messaging failure must never roll back a lesson.
  await ensureConversationForBooking({
    bookingId: booking.id,
    studentId: booking.student_id,
    tutorId: booking.tutor_id,
  });

  await NotificationService.emit({
    userId: user.id,
    type: "booking_created",
    title: "Lesson reserved",
    body: "Complete payment to confirm your booking.",
    data: { href: "/student/bookings" },
  });

  revalidatePath("/student/bookings");
  revalidatePath("/tutor/bookings");
  redirect(checkoutUrl);
}

/**
 * Starts a fresh Checkout Session for a booking whose previous payment
 * attempt failed or expired. The booking row itself (still pending_payment)
 * is the reservation, so this re-validates only that it's still the
 * caller's booking and the tutor is still bookable, then reuses the price
 * and slot already committed to the database — never re-derives price from
 * client input.
 */
export async function retryBookingPayment(
  _prevState: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const parsed = retryBookingPaymentSchema.safeParse({ bookingId: formData.get("bookingId") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid booking" };
  }
  const { bookingId } = parsed.data;

  if (!isStripeConfigured()) {
    return { error: "Payment is temporarily unavailable. Please try again later." };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) {
    return { error: auth.error };
  }
  const user = auth.user;

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, tutor_id, student_id, subject_id, lesson_duration_minutes, price_cents, platform_fee_cents, currency, status",
    )
    .eq("id", bookingId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (!booking) {
    return { error: "Booking not found" };
  }

  if (booking.status !== "pending_payment") {
    return { error: "This booking is no longer awaiting payment" };
  }

  const { data: tutorProfile } = await supabase
    .from("tutor_profiles")
    .select("verification_status, stripe_charges_enabled")
    .eq("id", booking.tutor_id)
    .maybeSingle();

  if (!tutorProfile || tutorProfile.verification_status !== "approved") {
    return { error: "This tutor is no longer available for booking" };
  }

  // Same gate as createBooking, re-checked here because a tutor's Connect
  // status can change between the original booking attempt and a retry
  // (e.g. Stripe restricts their account for a compliance review).
  const lessonType = booking.lesson_duration_minutes === 30 ? "trial" : "standard";
  if (lessonType === "standard" && !tutorProfile.stripe_charges_enabled) {
    return {
      error: "This tutor is not currently accepting payments. Please check back soon.",
    };
  }

  let checkoutUrl: string;
  try {
    checkoutUrl = await startCheckout(supabase, booking);
  } catch (err) {
    log.error("failed to restart checkout", err, { bookingId });
    return { error: "We couldn't start checkout. Please try again." };
  }

  // Re-verify AFTER the Stripe round trip. Opening a Checkout Session takes
  // hundreds of milliseconds, and the webhook for the previous session can
  // settle inside that window (student pays in one tab, clicks "Complete
  // payment" in a stale one). Without this re-read we would hand the student
  // a second payment page for a lesson they already paid for — a real double
  // charge, whose webhook the idempotency guard then silently discards.
  // The abandoned session simply expires on Stripe's side.
  const { data: current } = await supabase
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .maybeSingle();

  if (current?.status !== "pending_payment") {
    return { message: "This booking is already paid — no further payment is needed." };
  }

  redirect(checkoutUrl);
}

export async function cancelBooking(
  _prevState: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const parsed = cancelBookingSchema.safeParse({
    bookingId: formData.get("bookingId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) {
    return { error: auth.error };
  }
  const user = auth.user;

  const cancelLimit = await consumeRateLimit("cancelBooking", user.id);
  if (!cancelLimit.allowed) return { error: rateLimitMessage(cancelLimit) };

  // Migration 0030 stops a participant cancelling a PAID lesson with a direct
  // write, so the update below goes through the service role — which means the
  // ownership check RLS used to perform is now this function's job. Without
  // it, any signed-in user could cancel any booking by guessing its id.
  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, tutor_id, status, start_at, price_cents")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (!booking || (booking.student_id !== user.id && booking.tutor_id !== user.id)) {
    // Same answer whether the booking is someone else's or doesn't exist:
    // distinguishing them turns this into an existence oracle for booking ids.
    return { error: "Booking not found" };
  }

  // The same states the Cancel button is rendered for. The status trigger
  // would refuse anything else anyway, but with a database message rather than
  // one worth showing a student.
  if (!isCancellable(booking.status)) {
    return { error: "This booking can no longer be cancelled." };
  }

  // Who is cancelling changes the outcome, so it is resolved from the booking
  // rather than taken from the form: a student POSTing cancelledBy=tutor would
  // otherwise buy themselves a full refund inside the window.
  const cancelledBy = booking.student_id === user.id ? "student" : "tutor";
  const outcome = resolveCancellation({
    status: booking.status,
    startAt: new Date(booking.start_at),
    pricePaidCents: booking.price_cents,
    cancelledBy,
  });

  // Guarded by `.in("status", ...)`: between the read above and this write the
  // payment webhook can confirm the booking or the expiry sweep can cancel it.
  // The filter makes the transition conditional in the database rather than on
  // a value we read a moment ago.
  const { data: cancelled, error } = await createAdminClient()
    .from("bookings")
    .update({
      status: "cancelled",
      cancellation_reason: parsed.data.reason,
      cancelled_at: new Date().toISOString(),
      cancelled_by: user.id,
      // The rule that fired, by name. The policy WILL change, and a lesson
      // cancelled under the old one has to stay explainable under the new one.
      cancellation_policy: outcome.policy,
      refund_owed_cents: outcome.refundOwedCents,
    })
    .eq("id", parsed.data.bookingId)
    .in("status", ["pending_payment", "confirmed"])
    .select("student_id, tutor_id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }

  if (!cancelled) {
    return { error: "This booking can no longer be cancelled." };
  }

  // Ask Stripe for the refund the policy says is owed — and record only that
  // we ASKED. payments.status is written to 'refunded' in exactly one place,
  // handleChargeRefunded, from Stripe's own charge.refunded event. Nothing
  // here may shortcut that, because the difference between "we requested a
  // refund" and "the money went back" is the difference between a true
  // statement and a false one.
  const refundResult = await requestPolicyRefund({
    bookingId: parsed.data.bookingId,
    refundOwedCents: outcome.refundOwedCents,
    requestedBy: user.id,
  });

  // Tear down the live classroom so the Meet room is invalidated and both
  // parties' calendars are updated. Best-effort: the booking is already
  // cancelled and must stay cancelled even if the provider is unreachable.
  await MeetingService.cancelMeeting(parsed.data.bookingId);

  // Notify the other participant (whoever didn't cancel).
  const other = cancelled.student_id === user.id ? cancelled.tutor_id : cancelled.student_id;
  await NotificationService.emit({
    userId: other,
    type: "booking_cancelled",
    title: "A lesson was cancelled",
    body: parsed.data.reason ?? undefined,
    data: { href: other === cancelled.tutor_id ? "/tutor/bookings" : "/student/bookings" },
  });

  revalidatePath("/student/bookings");
  revalidatePath("/tutor/bookings");

  // The message tells the truth about the money, including when the truth is
  // "we've asked and it isn't back yet".
  return { message: cancellationMessage(outcome, refundResult) };
}

/**
 * Requests the refund a cancellation earned, if any.
 *
 * Returns what actually happened rather than a boolean, because the three
 * outcomes need to be said differently to the person cancelling: nothing was
 * owed, we asked Stripe and it accepted the request, or we could not ask at
 * all. The third is not a failure to hide — a student owed money who is told
 * "cancelled" and nothing else has no idea anything is outstanding.
 */
type RefundRequestResult = "not_owed" | "requested" | "unavailable";

async function requestPolicyRefund(params: {
  bookingId: string;
  refundOwedCents: number;
  requestedBy: string;
}): Promise<RefundRequestResult> {
  if (params.refundOwedCents <= 0) return "not_owed";

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("stripe_payment_intent_id, status")
    .eq("booking_id", params.bookingId)
    .maybeSingle();

  // A refund is owed by policy but nothing ever succeeded through Stripe.
  // Nothing to reverse, and saying "refunded" here would be a lie about money.
  if (!payment || payment.status !== "succeeded" || !payment.stripe_payment_intent_id) {
    return "not_owed";
  }

  if (!isStripeConfigured()) {
    // The obligation is already recorded on the booking (refund_owed_cents),
    // so it is visible in the admin refund queue and is not lost.
    log.error("refund owed but Stripe is not configured", new Error("stripe_unconfigured"), {
      bookingId: params.bookingId,
    });
    return "unavailable";
  }

  try {
    const refund = await refundBookingPayment({
      paymentIntentId: payment.stripe_payment_intent_id,
    });
    await admin
      .from("payments")
      .update({
        refund_requested_at: new Date().toISOString(),
        refund_requested_by: params.requestedBy,
        stripe_refund_id: refund.id,
      })
      .eq("booking_id", params.bookingId);
    return "requested";
  } catch (err) {
    log.error("refund request failed", err, { bookingId: params.bookingId });
    return "unavailable";
  }
}

function cancellationMessage(
  outcome: { refundOwedCents: number },
  refund: RefundRequestResult,
): string {
  if (outcome.refundOwedCents <= 0) {
    return "Lesson cancelled.";
  }
  if (refund === "requested") {
    return "Lesson cancelled. Your refund is on its way — it usually reaches your account within a few working days.";
  }
  if (refund === "unavailable") {
    return "Lesson cancelled. A refund is due on this lesson and our team has been notified — we'll be in touch.";
  }
  return "Lesson cancelled.";
}

/**
 * Moves a booking to a new time.
 *
 * The split between what is checked here and what is checked in the database
 * is deliberate and is documented at length in migration 0034. In short:
 *
 *   HERE (product policy)   the caller is a participant, there is enough
 *                           notice, and the new time is genuinely one of the
 *                           tutor's open slots — a rule that lives in
 *                           lib/utils/availability-slots.ts and would be a
 *                           second, divergent implementation if rewritten in
 *                           SQL.
 *   THERE (integrity)       participant, status, direction of time, derived
 *                           duration, reschedule count, and — the one that
 *                           must never be reimplemented in application code —
 *                           the GiST exclusion constraint that makes
 *                           double-booking impossible even under a race.
 *
 * No money moves. A reschedule is not a cancellation, so the payment, the
 * platform fee and the tutor's payout all stay exactly as they were.
 */
export async function rescheduleBooking(
  _prevState: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const parsed = rescheduleBookingSchema.safeParse({
    bookingId: formData.get("bookingId"),
    startAt: formData.get("startAt"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) return { error: auth.error };
  const user = auth.user;

  const limit = await consumeRateLimit("rescheduleBooking", user.id);
  if (!limit.allowed) return { error: rateLimitMessage(limit) };

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, student_id, tutor_id, status, start_at, lesson_duration_minutes")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (!booking || (booking.student_id !== user.id && booking.tutor_id !== user.id)) {
    return { error: "Booking not found" };
  }

  if (!isCancellable(booking.status)) {
    return { error: "Only an upcoming lesson can be moved." };
  }

  const newStart = new Date(parsed.data.startAt);
  if (Number.isNaN(newStart.getTime())) return { error: "Pick a valid time" };

  // A minimum notice on the OLD time as well as the new one: moving a lesson
  // ten minutes before it starts is a cancellation wearing a different hat,
  // and it would dodge the cancellation policy entirely.
  const hoursUntilOriginal = (new Date(booking.start_at).getTime() - Date.now()) / 3_600_000;
  if (hoursUntilOriginal < RESCHEDULE_MIN_NOTICE_HOURS) {
    return {
      error: `Lessons can't be moved within ${RESCHEDULE_MIN_NOTICE_HOURS} hours of the start time. Cancel it instead if you can't make it.`,
    };
  }

  if (newStart.getTime() <= Date.now()) {
    return { error: "Pick a time in the future" };
  }

  // The new time must be a slot this tutor actually offers. Computed from the
  // tutor's own rules in the tutor's own zone — the same call the booking page
  // makes, so the student can only pick what they were shown.
  const { data: tutorAccount } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", booking.tutor_id)
    .maybeSingle();

  const slots = await getTutorAvailableSlots({
    tutorId: booking.tutor_id,
    timeZone: tutorAccount?.timezone ?? "UTC",
    durationMinutes: booking.lesson_duration_minutes,
  });

  if (!slots.some((slot) => slot.startAt.getTime() === newStart.getTime())) {
    return { error: "That time isn't one of this tutor's open slots. Please pick another." };
  }

  // reschedule_booking is SECURITY DEFINER and re-checks everything above that
  // is an integrity concern. Its refusals come back as Postgres errors, which
  // are translated rather than shown.
  const { data: moved, error } = await createAdminClient().rpc("reschedule_booking", {
    p_booking_id: booking.id,
    p_new_start_at: newStart.toISOString(),
    p_reason: parsed.data.reason,
  });

  if (error) {
    if (error.code === EXCLUSION_VIOLATION) {
      return { error: "That time was just taken — pick another slot." };
    }
    if (/maximum number of times/.test(error.message)) {
      return {
        error: "This lesson has already been moved as many times as we allow. Cancel and rebook.",
      };
    }
    log.error("reschedule failed", error, { bookingId: booking.id });
    return { error: "We couldn't move that lesson. Please try again." };
  }

  const updated = moved as unknown as { id: string; start_at: string; end_at: string } | null;

  // Move the calendar event and the Meet room to match. Best-effort: the
  // booking has already moved and must stay moved even if the provider is
  // unreachable — the retry sweep picks up meeting_status = 'pending'.
  if (updated) {
    await MeetingService.rescheduleMeeting(booking.id, updated.start_at, updated.end_at);
  }

  const other = booking.student_id === user.id ? booking.tutor_id : booking.student_id;
  await NotificationService.emit({
    userId: other,
    type: "booking_rescheduled",
    title: "A lesson was moved",
    body: parsed.data.reason ?? "Check your lessons for the new time.",
    data: { href: other === booking.tutor_id ? "/tutor/bookings" : "/student/bookings" },
  });

  revalidatePath("/student/bookings");
  revalidatePath("/tutor/bookings");
  return { message: "Lesson moved. We've let the other person know." };
}
