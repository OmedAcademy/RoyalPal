import type Stripe from "stripe";

/**
 * RoyalPal shares one Stripe account with Lingora. There is no account-level
 * boundary between them, so *metadata is the boundary* — it must be written
 * on every object RoyalPal creates and checked on every event RoyalPal
 * consumes.
 *
 * This matters in both directions:
 *
 *  • Outbound — every Checkout Session, its PaymentIntent, and its ad-hoc
 *    Product carry `app`/`platform`/`environment`, so RoyalPal revenue can be
 *    isolated in reporting (see ROYALPAL_PAYMENT_SEARCH_QUERY).
 *
 *  • Inbound — a Stripe account fans every subscribed event type out to every
 *    webhook endpoint registered on it. RoyalPal's endpoint therefore receives
 *    Lingora's payment events too. Without a positive app check the only thing
 *    separating them is "does this event happen to carry a booking_id?", which
 *    is not a safe assumption for a sibling tutoring product.
 */

/** Identifies objects belonging to this application. */
export const STRIPE_APP_TAG = "royalpal";

/**
 * Deployment environment recorded on every payment object. Vercel sets
 * VERCEL_ENV to production/preview/development; NODE_ENV is the local
 * fallback. Lets reporting separate real revenue from preview/test traffic
 * inside the shared account.
 */
export function currentEnvironment(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

/** Ownership tags applied to every Stripe object RoyalPal creates. */
export function appMetadata(): { app: string; platform: string; environment: string } {
  return {
    app: STRIPE_APP_TAG,
    platform: STRIPE_APP_TAG,
    environment: currentEnvironment(),
  };
}

/**
 * True only for objects this application created. Deliberately a positive
 * check (`app === "royalpal"`) rather than "not Lingora": an untagged or
 * unknown-app event is treated as foreign, so adding a third product to the
 * shared account can never silently start feeding events into RoyalPal.
 */
export function isRoyalPalMetadata(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadata?.app === STRIPE_APP_TAG;
}

/**
 * Stripe Search query isolating RoyalPal payments in the shared account:
 *
 *   stripe.paymentIntents.search({ query: ROYALPAL_PAYMENT_SEARCH_QUERY })
 *
 * Add ` AND metadata['environment']:'production'` to exclude preview traffic.
 * Works because the tags are written to the PaymentIntent, not only the
 * Checkout Session — Stripe does not copy Session metadata onto the
 * PaymentIntent, and reporting/payout reconciliation reads the PaymentIntent.
 */
export const ROYALPAL_PAYMENT_SEARCH_QUERY = `metadata['app']:'${STRIPE_APP_TAG}'`;
