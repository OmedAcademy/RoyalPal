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

export function getStripe(): Stripe {
  if (!stripeSingleton) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripeSingleton = new Stripe(secretKey, {
      apiVersion: "2026-06-24.dahlia",
    });
  }
  return stripeSingleton;
}
