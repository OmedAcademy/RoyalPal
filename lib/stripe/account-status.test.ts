import { describe, it, expect } from "vitest";
import {
  hasPausedBankPayouts,
  payoutBannerFor,
  resolvePayoutStatus,
  type ConnectAccountState,
} from "@/lib/stripe/account-status";

/**
 * These branches decide what a tutor is told about their own money, so the
 * edges matter more than the happy path — particularly the pre-migration
 * case, where the columns are absent rather than false and must not be read
 * as "something is wrong".
 */

const ACCT = "acct_1";

const account = (over: ConnectAccountState = {}): ConnectAccountState => ({
  stripe_account_id: ACCT,
  stripe_charges_enabled: false,
  stripe_payouts_enabled: false,
  stripe_details_submitted: false,
  stripe_disabled_reason: null,
  ...over,
});

describe("resolvePayoutStatus", () => {
  it("reports unconfigured before anything else when there are no credentials", () => {
    // Even a fully onboarded tutor is 'unconfigured' on a deployment with no
    // Stripe keys — the platform, not the tutor, is what's missing.
    expect(resolvePayoutStatus(false, account({ stripe_charges_enabled: true }))).toBe(
      "unconfigured",
    );
  });

  it("reports not_connected when the tutor has no account", () => {
    expect(resolvePayoutStatus(true, account({ stripe_account_id: null }))).toBe("not_connected");
    expect(resolvePayoutStatus(true, null)).toBe("not_connected");
    expect(resolvePayoutStatus(true, undefined)).toBe("not_connected");
  });

  it("reports active once charges are enabled", () => {
    expect(resolvePayoutStatus(true, account({ stripe_charges_enabled: true }))).toBe("active");
  });

  it("reports verifying when details are in but charges are not yet enabled", () => {
    expect(resolvePayoutStatus(true, account({ stripe_details_submitted: true }))).toBe(
      "verifying",
    );
  });

  it("reports incomplete when onboarding was never finished", () => {
    expect(resolvePayoutStatus(true, account())).toBe("incomplete");
  });

  it("lets restriction outrank active — an account can be both", () => {
    // Stripe commonly leaves charges enabled up to a future deadline while
    // already flagging the account. Reporting 'active' there would hide the
    // deadline until it silently passed.
    const status = resolvePayoutStatus(
      true,
      account({ stripe_charges_enabled: true, stripe_disabled_reason: "requirements.past_due" }),
    );

    expect(status).toBe("restricted");
  });

  it("lets restriction outrank verifying too", () => {
    expect(
      resolvePayoutStatus(
        true,
        account({ stripe_details_submitted: true, stripe_disabled_reason: "under_review" }),
      ),
    ).toBe("restricted");
  });

  it("treats absent columns (migration 0026 not applied) as incomplete, never restricted", () => {
    // The row exists and has an account id, but none of the 0026 columns do.
    // Absent must not be read as evidence of a problem.
    const status = resolvePayoutStatus(true, { stripe_account_id: ACCT });

    expect(status).toBe("incomplete");
  });
});

describe("hasPausedBankPayouts", () => {
  it("is true when charges work but bank payouts are paused", () => {
    expect(
      hasPausedBankPayouts(
        account({ stripe_charges_enabled: true, stripe_payouts_enabled: false }),
      ),
    ).toBe(true);
  });

  it("is false when both are enabled", () => {
    expect(
      hasPausedBankPayouts(account({ stripe_charges_enabled: true, stripe_payouts_enabled: true })),
    ).toBe(false);
  });

  it("is false when the tutor isn't earning yet — nothing to be stuck", () => {
    expect(
      hasPausedBankPayouts(
        account({ stripe_charges_enabled: false, stripe_payouts_enabled: false }),
      ),
    ).toBe(false);
  });

  it("requires an explicit false — absent (pre-0026) is not 'paused'", () => {
    expect(hasPausedBankPayouts({ stripe_account_id: ACCT, stripe_charges_enabled: true })).toBe(
      false,
    );
  });

  it("handles a missing account without throwing", () => {
    expect(hasPausedBankPayouts(null)).toBe(false);
    expect(hasPausedBankPayouts(undefined)).toBe(false);
  });
});

describe("payoutBannerFor — dashboard visibility", () => {
  it("stays silent for a healthy earning account", () => {
    // The most important case: a banner that is always present is a banner
    // nobody reads, so the alerting ones stop working.
    expect(
      payoutBannerFor(
        true,
        account({ stripe_charges_enabled: true, stripe_payouts_enabled: true }),
      ),
    ).toBeNull();
  });

  it("stays silent when the platform has no Stripe configured", () => {
    // Not the tutor's problem, and "Connect Stripe" would send them into a
    // flow that cannot succeed.
    expect(payoutBannerFor(false, account({ stripe_account_id: null }))).toBeNull();
  });

  it("surfaces a restriction on the dashboard — the gap this closes", () => {
    // Previously only visible if the tutor happened to open /tutor/payouts,
    // so a restricted account presented as "my bookings stopped converting".
    expect(
      payoutBannerFor(true, account({ stripe_disabled_reason: "requirements.past_due" })),
    ).toBe("restricted");
  });

  it("surfaces a restriction even while charges still work", () => {
    expect(
      payoutBannerFor(
        true,
        account({ stripe_charges_enabled: true, stripe_disabled_reason: "under_review" }),
      ),
    ).toBe("restricted");
  });

  it("prompts a tutor who never connected an account", () => {
    expect(payoutBannerFor(true, account({ stripe_account_id: null }))).toBe("not_connected");
    expect(payoutBannerFor(true, null)).toBe("not_connected");
  });

  it("prompts a tutor who abandoned onboarding", () => {
    expect(payoutBannerFor(true, account())).toBe("incomplete");
  });

  it("informs (does not alarm) a tutor awaiting Stripe review", () => {
    expect(payoutBannerFor(true, account({ stripe_details_submitted: true }))).toBe("verifying");
  });

  it("flags earnings piling up in Stripe instead of reaching a bank", () => {
    // Healthy by every other measure, which is exactly why it is easy to
    // miss without a banner.
    expect(
      payoutBannerFor(
        true,
        account({ stripe_charges_enabled: true, stripe_payouts_enabled: false }),
      ),
    ).toBe("payouts_paused");
  });

  it("does not invent a problem when migration 0026 has not been applied", () => {
    // The 0026 columns are absent rather than false. An account with charges
    // enabled must read as healthy, not as 'payouts paused'.
    expect(payoutBannerFor(true, { stripe_account_id: ACCT, stripe_charges_enabled: true })).toBe(
      null,
    );
  });

  it("agrees with resolvePayoutStatus for every state — the two cannot drift", () => {
    const cases: [ConnectAccountState | null, boolean][] = [
      [account({ stripe_charges_enabled: true, stripe_payouts_enabled: true }), true],
      [account({ stripe_disabled_reason: "under_review" }), true],
      [account({ stripe_account_id: null }), true],
      [account(), true],
      [account({ stripe_details_submitted: true }), true],
      [null, false],
    ];

    for (const [acct, configured] of cases) {
      const status = resolvePayoutStatus(configured, acct);
      const banner = payoutBannerFor(configured, acct);
      // A banner is shown for exactly the non-healthy, non-unconfigured
      // states, plus the paused-payouts sub-case of 'active'.
      const expectSilent =
        status === "unconfigured" || (status === "active" && !hasPausedBankPayouts(acct));
      expect(banner === null, `${status}`).toBe(expectSilent);
    }
  });
});
