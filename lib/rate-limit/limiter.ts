import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ component: "rate-limit" });

/**
 * Named policies, in one place, so a limit is a product decision someone can
 * review rather than a number buried at a call site.
 *
 * The numbers are deliberately generous for humans and ruinous for scripts:
 * five sign-in attempts a minute is more than anyone types by hand and far
 * fewer than a credential-stuffing run needs to be worth mounting.
 */
export const RATE_LIMITS = {
  /** Per email address. The expensive one to get wrong in either direction. */
  login: { limit: 5, windowSeconds: 60 },
  signup: { limit: 3, windowSeconds: 600 },
  /** Per email. Also throttles the outbound mail bill, not just the attacker. */
  passwordReset: { limit: 3, windowSeconds: 900 },
  /** Per user. A booking is expensive server-side (Stripe round trip). */
  createBooking: { limit: 10, windowSeconds: 300 },
  cancelBooking: { limit: 10, windowSeconds: 300 },
  rescheduleBooking: { limit: 10, windowSeconds: 3600 },
  sendMessage: { limit: 30, windowSeconds: 60 },
  createTicket: { limit: 5, windowSeconds: 3600 },
  ticketReply: { limit: 20, windowSeconds: 3600 },
  contactForm: { limit: 3, windowSeconds: 3600 },
  avatarUpload: { limit: 10, windowSeconds: 3600 },
  createReview: { limit: 10, windowSeconds: 3600 },
  favoriteToggle: { limit: 60, windowSeconds: 60 },
  /** Per IP, for the unauthenticated surface. */
  anonymous: { limit: 30, windowSeconds: 60 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date | null;
  /** True when the limiter could not reach the database and let the request
   * through. Callers do not branch on this; it exists so tests and logs can
   * tell "allowed" apart from "not actually checked". */
  degraded: boolean;
};

/**
 * Identifiers can be personal data (an email address) and rate_limits is a
 * table that gets read during incidents by people who have no business
 * seeing who tried to sign in. Hashing keeps the key stable and useful for
 * counting while making the table itself uninteresting. Truncated to 160
 * bits, which is far past collision-relevance for a counter.
 */
function hashIdentifier(identifier: string): string {
  return createHash("sha256").update(identifier.trim().toLowerCase()).digest("hex").slice(0, 40);
}

/**
 * Consume one unit against `name` for `identifier`.
 *
 * FAILS OPEN, LOUDLY. If the database is unreachable this returns allowed
 * with `degraded: true` and logs an error. That is a deliberate choice: the
 * limiter is a mitigation layered on top of authentication and RLS, not the
 * authorization boundary itself, and making it a hard dependency converts a
 * limiter outage into a total outage of signup, login and booking. The
 * alternative — failing closed — trades a rare abuse window for a
 * self-inflicted denial of service, and the thing it protects is still
 * protected by the checks underneath it.
 */
export async function consumeRateLimit(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  const policy = RATE_LIMITS[name];
  const key = `${name}:${hashIdentifier(identifier)}`;

  try {
    const { data, error } = await createAdminClient().rpc("consume_rate_limit", {
      p_key: key,
      p_limit: policy.limit,
      p_window_seconds: policy.windowSeconds,
    });

    if (error) throw error;

    // The function returns a single-row set.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("consume_rate_limit returned no row");

    return {
      allowed: row.allowed,
      remaining: row.remaining,
      resetAt: new Date(row.reset_at),
      degraded: false,
    };
  } catch (err) {
    log.error("rate limiter unavailable; allowing request", err, { policy: name });
    return { allowed: true, remaining: policy.limit, resetAt: null, degraded: true };
  }
}

/** Seconds until the window resets, for a Retry-After header or UI copy. */
export function retryAfterSeconds(result: RateLimitResult): number {
  if (!result.resetAt) return 60;
  return Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
}

/**
 * The user-facing refusal. Deliberately vague about which limit was hit and
 * never says whether the identifier exists — a rate-limit message is a
 * cheap account-enumeration oracle if it is specific.
 */
export function rateLimitMessage(result: RateLimitResult): string {
  const seconds = retryAfterSeconds(result);
  const minutes = Math.ceil(seconds / 60);
  return seconds <= 90
    ? "Too many attempts. Please wait a moment and try again."
    : `Too many attempts. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
