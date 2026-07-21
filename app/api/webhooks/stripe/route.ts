import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import {
  handleCheckoutSessionCompleted,
  handleCheckoutSessionExpired,
  handlePaymentIntentFailed,
  handlePaymentIntentSucceeded,
} from "@/lib/stripe/webhook-handlers";

/**
 * Stripe webhook endpoint. Must read the raw request body (not parsed
 * JSON) for signature verification — Route Handlers give raw access via
 * request.text() by default, unlike the old Pages Router API routes which
 * needed bodyParser disabled.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      {
        status: 400,
      },
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      case "checkout.session.expired":
        await handleCheckoutSessionExpired(event.data.object);
        break;
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object);
        break;
      default:
        // Unhandled event types are expected — Stripe sends far more event
        // types than this integration acts on. Acknowledge with 200 so
        // Stripe doesn't retry them.
        break;
    }
  } catch (err) {
    // A thrown error (vs. a handled/logged one inside the handler) means
    // something unexpected broke — return 500 so Stripe retries delivery
    // instead of silently losing the event.
    console.error("[stripe webhook] unhandled error processing event", event.type, err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
