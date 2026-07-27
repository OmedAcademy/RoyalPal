import "server-only";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import { appMetadata } from "@/lib/stripe/app-metadata";

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
  // Ownership tags — see lib/stripe/app-metadata.ts. Present on the Session,
  // the PaymentIntent and the Product so the shared Stripe account can be
  // filtered by application.
  app: string;
  platform: string;
  environment: string;
};

/**
 * Builds the line item for a lesson.
 *
 * Deliberately NOT a persistent Price per tutor. Stripe Prices are immutable,
 * so a Price catalog keyed by tutor rate would mint a new object on every rate
 * change and grow without bound (tutors × lesson types × every price they ever
 * set). `unit_amount` with a dynamic value is Stripe's documented pattern for
 * marketplace pricing.
 *
 * Product handling, in preference order:
 *  1. STRIPE_ROYALPAL_PRODUCT_ID set → attach every lesson to that one stable
 *     RoyalPal Product. Preferred: gives a single, clearly-named RoyalPal
 *     entry in the shared account's product catalog, cleanly separate from
 *     Lingora's, without creating a Product per checkout.
 *  2. Unset → fall back to an ad-hoc `product_data`, tagged with the app
 *     metadata and a "RoyalPal —" name prefix so it is still attributable.
 */
function buildPriceData(params: {
  currency: string;
  priceCents: number;
  lessonLabel: string;
  subjectName: string;
  tutorName: string;
}): Stripe.Checkout.SessionCreateParams.LineItem.PriceData {
  const productId = process.env.STRIPE_ROYALPAL_PRODUCT_ID;

  if (productId) {
    return {
      currency: params.currency,
      unit_amount: params.priceCents,
      product: productId,
    };
  }

  return {
    currency: params.currency,
    unit_amount: params.priceCents,
    product_data: {
      name: `RoyalPal — ${params.lessonLabel} lesson: ${params.subjectName} with ${params.tutorName}`,
      metadata: appMetadata(),
    },
  };
}

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
    ...appMetadata(),
  };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const lessonLabel = params.lessonType === "trial" ? "Trial" : "Standard";

  return getStripe().checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: buildPriceData({
          currency: params.currency,
          priceCents: params.priceCents,
          lessonLabel,
          subjectName: params.subjectName,
          tutorName: params.tutorName,
        }),
      },
    ],
    // Set on both the Session and the underlying PaymentIntent: Stripe does
    // not copy Session metadata onto the PaymentIntent automatically, and
    // the webhook handler needs booking_id available on whichever object a
    // given event delivers (checkout.session.* vs payment_intent.*).
    // The PaymentIntent copy is also what makes revenue reporting filterable
    // by app in the account shared with Lingora.
    metadata,
    payment_intent_data: { metadata },
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_LIFETIME_SECONDS,
    success_url: `${appUrl}/student/bookings?payment=success`,
    cancel_url: `${appUrl}/api/stripe/checkout-cancelled?booking_id=${params.bookingId}`,
  });
}
