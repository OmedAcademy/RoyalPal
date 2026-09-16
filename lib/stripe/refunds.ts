import "server-only";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import { appMetadata } from "@/lib/stripe/app-metadata";

/**
 * Refunds a booking's payment in full, reversing the Connect transfer and
 * the platform's application fee when — and only when — the original
 * charge actually was a destination charge (Milestone 2.4).
 *
 * Whether it was is determined by asking Stripe directly (retrieving the
 * live PaymentIntent) rather than trusting anything recorded in our own
 * database: `reverse_transfer`/`refund_application_fee` are invalid
 * parameters on a refund for a PaymentIntent that never had an associated
 * transfer, which is exactly the case for a lesson paid for before its
 * tutor completed Connect onboarding. Passing them unconditionally would
 * make refunds for pre-Connect payments fail outright.
 *
 * Partial refunds are out of scope for this milestone — every call refunds
 * the payment's full captured amount.
 */
export async function refundBookingPayment(params: {
  paymentIntentId: string;
}): Promise<Stripe.Refund> {
  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.retrieve(params.paymentIntentId);
  const hasTransfer = Boolean(paymentIntent.transfer_data?.destination);

  return stripe.refunds.create({
    payment_intent: params.paymentIntentId,
    ...(hasTransfer ? { reverse_transfer: true, refund_application_fee: true } : {}),
    metadata: appMetadata(),
  });
}
