import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import { logger, newRequestId } from "@/lib/observability/logger";
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

  // A missing secret is a server misconfiguration, not a bad request. Without
  // this guard `undefined` was passed to constructEvent, which throws, and we
  // answered 400 "signature verification failed" — a misleading response that
  // would make every payment silently fail to confirm on a misconfigured
  // deploy while looking like Stripe's fault. 500 is honest and makes Stripe
  // retry once the config is fixed.
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      {
        status: 400,
      },
    );
  }

  // Stripe's event id is the natural correlation key: it is stable across
  // the retries Stripe performs, so every delivery attempt of the same event
  // shares one trace.
  const log = logger.child({
    component: "stripe-webhook",
    requestId: newRequestId(),
    stripeEventId: event.id,
    eventType: event.type,
  });

  const startedAt = Date.now();

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
        log.debug("event type not handled");
        break;
    }
  } catch (err) {
    // A thrown error (vs. a handled/logged one inside the handler) means
    // something unexpected broke — return 500 so Stripe retries delivery
    // instead of silently losing the event.
    log.error("unhandled error processing event", err, { durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  log.info("event processed", { durationMs: Date.now() - startedAt });
  return NextResponse.json({ received: true });
}
