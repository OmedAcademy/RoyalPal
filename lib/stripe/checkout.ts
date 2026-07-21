import "server-only";
import { getStripe } from "@/lib/stripe/client";

/** Stripe's minimum allowed Checkout Session lifetime. Bounding sessions to
 * this window (rather than the 24h default) keeps an abandoned checkout
 * from holding a tutor's slot for long — checkout.session.expired fires
 * and frees the booking well within the two-week booking window. */
const CHECKOUT_SESSION_LIFETIME_SECONDS = 30 * 60;

export type BookingCheckoutMetadata = {
  booking_id: string;
  tutor_id: string;
  student_id: string;
  lesson_type: "standard" | "trial";
  duration_minutes: string;
  subject_id: string;
};

export async function createBookingCheckoutSession(params: {
  bookingId: string;
  tutorId: string;
  studentId: string;
  subjectId: number;
  lessonType: "standard" | "trial";
  durationMinutes: number;
  priceCents: number;
  currency: string;
  subjectName: string;
  tutorName: string;
}) {
  const metadata: BookingCheckoutMetadata = {
    booking_id: params.bookingId,
    tutor_id: params.tutorId,
    student_id: params.studentId,
    lesson_type: params.lessonType,
    duration_minutes: String(params.durationMinutes),
    subject_id: String(params.subjectId),
  };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const lessonLabel = params.lessonType === "trial" ? "Trial" : "Standard";

  return getStripe().checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: params.currency,
          unit_amount: params.priceCents,
          product_data: {
            name: `${lessonLabel} lesson: ${params.subjectName} with ${params.tutorName}`,
          },
        },
      },
    ],
    // Set on both the Session and the underlying PaymentIntent: Stripe does
    // not copy Session metadata onto the PaymentIntent automatically, and
    // the webhook handler needs booking_id available on whichever object a
    // given event delivers (checkout.session.* vs payment_intent.*).
    metadata,
    payment_intent_data: { metadata },
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_LIFETIME_SECONDS,
    success_url: `${appUrl}/student/bookings?payment=success`,
    cancel_url: `${appUrl}/api/stripe/checkout-cancelled?booking_id=${params.bookingId}`,
  });
}
