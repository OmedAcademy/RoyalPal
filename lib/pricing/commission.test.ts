import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  platformFeeCents,
  resolvePlatformFeeBps,
} from "@/lib/pricing/commission";

/**
 * Commission is the number that decides how RoyalPal makes money and what a
 * tutor takes home, so the edges matter more than the happy path: a
 * zero-commission tutor, a typo'd env var, and sub-cent rounding all have
 * real financial consequences and none of them are visible in normal use.
 */

afterEach(() => {
  delete process.env.PLATFORM_FEE_BPS;
});

describe("resolvePlatformFeeBps", () => {
  it("defaults to 10% when nothing overrides it", () => {
    expect(resolvePlatformFeeBps(null)).toBe(1000);
    expect(DEFAULT_PLATFORM_FEE_BPS).toBe(1000);
  });

  it("uses the deployment override when set", () => {
    process.env.PLATFORM_FEE_BPS = "1500";
    expect(resolvePlatformFeeBps(null)).toBe(1500);
  });

  it("lets a tutor's negotiated rate beat the deployment override", () => {
    process.env.PLATFORM_FEE_BPS = "1500";
    expect(resolvePlatformFeeBps(500)).toBe(500);
  });

  it("treats a 0% tutor as a real rate, not as 'unset'", () => {
    // The bug this pins: `tutorOverride || default` would silently charge a
    // zero-commission tutor the full platform rate.
    expect(resolvePlatformFeeBps(0)).toBe(0);
  });

  it("ignores a malformed env var rather than letting a typo set the take rate", () => {
    for (const bad of ["", "abc", "-5", "10.5", "99999"]) {
      process.env.PLATFORM_FEE_BPS = bad;
      expect(resolvePlatformFeeBps(null), bad).toBe(DEFAULT_PLATFORM_FEE_BPS);
    }
  });

  it("clamps an out-of-range tutor override to 100%", () => {
    expect(resolvePlatformFeeBps(50_000)).toBe(10_000);
  });
});

describe("platformFeeCents", () => {
  it("takes 10% of a whole-dollar price", () => {
    expect(platformFeeCents(5000, 1000)).toBe(500);
  });

  it("supports a fractional-percentage rate exactly", () => {
    // 12.5% of $50.00 — the case a float percentage would make awkward.
    expect(platformFeeCents(5000, 1250)).toBe(625);
  });

  it("rounds DOWN so a sub-cent remainder favours the tutor, not the platform", () => {
    // 10% of $9.99 is 99.9 cents. Rounding up would quietly take the extra
    // cent out of the tutor's payout on every such lesson.
    expect(platformFeeCents(999, 1000)).toBe(99);
  });

  it("returns zero for a zero-commission tutor", () => {
    expect(platformFeeCents(5000, 0)).toBe(0);
  });

  it("never exceeds the price", () => {
    expect(platformFeeCents(5000, 10_000)).toBe(5000);
    expect(platformFeeCents(5000, 99_999)).toBe(5000);
  });

  it("never returns a negative fee", () => {
    expect(platformFeeCents(5000, -100)).toBe(0);
  });

  it("leaves the tutor a non-negative payout at every rate", () => {
    for (const bps of [0, 1, 999, 1000, 5000, 10_000]) {
      const fee = platformFeeCents(5000, bps);
      expect(5000 - fee).toBeGreaterThanOrEqual(0);
    }
  });
});
