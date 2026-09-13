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
} from "@/lib/validations/booking";
import { NotificationService } from "@/lib/notifications/service";
import { MeetingService } from "@/lib/meet/service";
import { logger } from "@/lib/observability/logger";
import { platformFeeCents, resolvePlatformFeeBps } from "@/lib/pricing/commission";
import type { Database } from "@/types/database";

export type BookingActionState = {
  error?: string;
  message?: string;
};

const log = logger.child({ component: "booking-action" });

const EXCLUSION_VIOLATION = "23P01";

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
    supabase
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

  // Every lesson is paid, so an unconfigured Stripe makes booking
  // impossible. Refuse up front rather than creating a booking row and
  // immediately cancelling it when checkout fails.
  if (!isStripeConfigured()) {
    return { error: "Booking is temporarily unavailable. Please try again later." };
  }

  const { data: tutorProfile } = await supabase
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

  const { data: cancelled, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled", cancellation_reason: parsed.data.reason })
    .eq("id", parsed.data.bookingId)
    .select("student_id, tutor_id")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }

  // Tear down the live classroom so the Meet room is invalidated and both
  // parties' calendars are updated. Best-effort: the booking is already
  // cancelled and must stay cancelled even if the provider is unreachable.
  await MeetingService.cancelMeeting(parsed.data.bookingId);

  // Notify the other participant (whoever didn't cancel).
  if (cancelled) {
    const other = cancelled.student_id === user.id ? cancelled.tutor_id : cancelled.student_id;
    await NotificationService.emit({
      userId: other,
      type: "booking_cancelled",
      title: "A lesson was cancelled",
      body: parsed.data.reason ?? undefined,
      data: { href: other === cancelled.tutor_id ? "/tutor/bookings" : "/student/bookings" },
    });
  }

  revalidatePath("/student/bookings");
  revalidatePath("/tutor/bookings");

  return { message: "Booking cancelled" };
}
