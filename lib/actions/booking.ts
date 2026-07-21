"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createBookingCheckoutSession } from "@/lib/stripe/checkout";
import {
  createBookingSchema,
  retryBookingPaymentSchema,
  cancelBookingSchema,
} from "@/lib/validations/booking";
import type { Database } from "@/types/database";

export type BookingActionState = {
  error?: string;
  message?: string;
};

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
  // a Server Action instead of an inbound Stripe event. Upserted (not
  // inserted) so a retry can reuse the same row with a fresh session id.
  const admin = createAdminClient();
  const { error: paymentError } = await admin.from("payments").upsert(
    {
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
      status: "requires_payment",
      paid_at: null,
    },
    { onConflict: "booking_id" },
  );

  if (paymentError) {
    // Non-fatal: the webhook upserts this same row when the payment
    // succeeds, so a dropped write here doesn't lose the payment record —
    // just log it and let checkout proceed.
    console.error("[booking] failed to record payment attempt", paymentError);
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in" };
  }

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
    console.error("[booking] failed to start checkout", err);
    return { error: "We couldn't start checkout. Please try again." };
  }

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in" };
  }

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
    console.error("[booking] failed to restart checkout", err);
    return { error: "We couldn't start checkout. Please try again." };
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in" };
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled", cancellation_reason: parsed.data.reason })
    .eq("id", parsed.data.bookingId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/student/bookings");
  revalidatePath("/tutor/bookings");

  return { message: "Booking cancelled" };
}
