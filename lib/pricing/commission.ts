/**
 * RoyalPal's platform commission.
 *
 * Expressed in BASIS POINTS (1 bp = 0.01%), never a float percentage.
 * `priceCents * 0.15` is exact today but stops being exact the moment a
 * rate like 12.5% or 7.3% is configured, and a fee that rounds differently
 * than the tutor's payout is a reconciliation bug that only shows up in
 * production. Integers all the way through remove the question.
 *
 * Resolution order, most specific first:
 *   1. The tutor's own `platform_fee_bps` (negotiated / promotional rate)
 *   2. PLATFORM_FEE_BPS env var (per-deployment override)
 *   3. DEFAULT_PLATFORM_FEE_BPS
 *
 * This module is deliberately dependency-free and side-effect-free so it
 * can be unit-tested directly and imported from any layer.
 */

/** 10% — the product's stated default take rate. */
export const DEFAULT_PLATFORM_FEE_BPS = 1000;

/** 100% in basis points. A fee may equal the price (a fully-platform lesson)
 * but may never exceed it, which would mean paying the tutor negative money. */
const MAX_FEE_BPS = 10_000;

/** Parses the deployment-level override, ignoring anything nonsensical
 * rather than letting a typo'd env var silently set the take rate to 0. */
function envFeeBps(): number | null {
  const raw = process.env.PLATFORM_FEE_BPS;
  if (!raw) return null;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_FEE_BPS) {
    return null;
  }
  return parsed;
}

/**
 * The commission rate that applies to a booking, in basis points.
 *
 * `tutorOverrideBps` comes from tutor_profiles.platform_fee_bps and is
 * null for the overwhelming majority of tutors. Note that 0 is a REAL
 * value (a zero-commission tutor), so it must not be collapsed into the
 * default by a truthiness check.
 */
export function resolvePlatformFeeBps(tutorOverrideBps?: number | null): number {
  if (typeof tutorOverrideBps === "number" && tutorOverrideBps >= 0) {
    return Math.min(tutorOverrideBps, MAX_FEE_BPS);
  }
  return envFeeBps() ?? DEFAULT_PLATFORM_FEE_BPS;
}

/**
 * RoyalPal's cut of a lesson, in cents.
 *
 * Rounds down. The tutor's share is the remainder, so rounding the fee UP
 * would let a sub-cent rounding error come out of the tutor's payout
 * rather than the platform's — a small unfairness, but one that compounds
 * across every lesson and is invisible until someone reconciles.
 */
export function platformFeeCents(priceCents: number, feeBps: number): number {
  const bounded = Math.max(0, Math.min(feeBps, MAX_FEE_BPS));
  return Math.floor((priceCents * bounded) / MAX_FEE_BPS);
}
