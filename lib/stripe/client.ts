import "server-only";
import Stripe from "stripe";

/**
 * Server-only Stripe SDK singleton, constructed lazily on first use. Never
 * import this from a Client Component — the `server-only` guard above
 * throws a build error if that happens, matching the pattern used by
 * lib/supabase/admin.ts for the other server-side-only secret client.
 *
 * Lazy rather than module-level: `next build` executes route modules while
 * collecting page data, and a top-level `new Stripe(...)` crashes the whole
 * build in any environment where STRIPE_SECRET_KEY isn't set (local dev
 * before M8 config, CI). Deferring construction to request time keeps the
 * missing-key failure scoped to actual Stripe calls.
 */
let stripeSingleton: Stripe | null = null;

/**
 * Whether Stripe credentials exist at all.
 *
 * Distinguishes "this deployment has no Stripe configured yet" from "Stripe
 * rejected our request". Both used to surface as the same generic failure,
 * which sent us hunting for a payments bug when the real answer was an
 * unset env var. Callers should branch on this BEFORE calling getStripe()
 * so the user and the logs get an accurate reason.
 */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Thrown only when credentials are missing — never for a Stripe API error,
 * so callers can tell configuration problems from payment problems. */
export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Stripe is not configured (STRIPE_SECRET_KEY is unset)");
    this.name = "StripeNotConfiguredError";
  }
}

export function getStripe(): Stripe {
  if (!stripeSingleton) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new StripeNotConfiguredError();
    }
    stripeSingleton = new Stripe(secretKey, {
      apiVersion: "2026-06-24.dahlia",
    });
  }
  return stripeSingleton;
}
