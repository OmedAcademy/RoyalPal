"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { activeUserOrError } from "@/lib/supabase/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createBookingCheckoutSession } from "@/lib/stripe/checkout";
import {
  createBookingSchema,
  retryBookingPaymentSchema,
  cancelBookingSchema,
} from "@/lib/validations/booking";
import { NotificationService } from "@/lib/notifications/service";
import { MeetingService } from "@/lib/meet/service";
import { logger } from "@/lib/observability/logger";
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
    currency: string;
  },
): Promise<string> {
  const lessonType = booking.lesson_duration_minutes === 30 ? "trial" : "standard";

  const [{ data: subject }, { data: tutor }] = await Promise.all([
    supabase.from("subjects").select("name").eq("id", booking.subject_id).single(),
    supabase.from("profiles").select("full_name").eq("id", booking.tutor_id).single(),
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

  const { data: tutorProfile } = await supabase
    .from("tutor_profiles")
    .select("hourly_rate_cents, trial_price_cents, currency, verification_status")
    .eq("id", tutorId)
    .maybeSingle();

  if (!tutorProfile || tutorProfile.verification_status !== "approved") {
    return { error: "This tutor is not available for booking" };
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

  const startDate = new Date(startAt);
  if (startDate.getTime() <= Date.now()) {
    return { error: "Pick a time in the future" };
  }
  const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);

  // Price is always derived server-side from the tutor's stored rate, never
  // from client input — the form only ever sends tutorId/subjectId/time.
  const priceCents =
    lessonType === "trial" ? tutorProfile.trial_price_cents! : tutorProfile.hourly_rate_cents;
  const platformFeeCents = Math.round(priceCents * 0.15);

  const { data: booking, error: insertError } = await supabase
    .from("bookings")
    .insert({
      student_id: user.id,
      tutor_id: tutorId,
      subject_id: subjectId,
      start_at: startDate.toISOString(),
      end_at: endDate.toISOString(),
      lesson_duration_minutes: durationMinutes,
      price_cents: priceCents,
      platform_fee_cents: platformFeeCents,
      currency: tutorProfile.currency,
    })
    .select("id, tutor_id, student_id, subject_id, lesson_duration_minutes, price_cents, currency")
    .single();

  if (insertError) {
    if (insertError.code === EXCLUSION_VIOLATION) {
      return { error: "That time was just booked by someone else — pick another slot." };
    }
    return { error: insertError.message };
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

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) {
    return { error: auth.error };
  }
  const user = auth.user;

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, tutor_id, student_id, subject_id, lesson_duration_minutes, price_cents, currency, status",
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
    .select("verification_status")
    .eq("id", booking.tutor_id)
    .maybeSingle();

  if (!tutorProfile || tutorProfile.verification_status !== "approved") {
    return { error: "This tutor is no longer available for booking" };
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
