import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Same shared-Stripe-account contract as checkout.test.ts, applied to
 * Connect: Account objects must carry the app/platform/environment tags
 * too, not just payment objects, and destination charges require the
 * transfers capability to be explicitly requested.
 */

const accountsCreate = vi.fn();
const accountLinksCreate = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    accounts: { create: accountsCreate },
    accountLinks: { create: accountLinksCreate },
  }),
}));

const { createExpressAccount, createOnboardingLink } = await import("@/lib/stripe/connect");

beforeEach(() => {
  accountsCreate.mockReset();
  accountLinksCreate.mockReset();
  accountsCreate.mockResolvedValue({ id: "acct_1" });
  accountLinksCreate.mockResolvedValue({ url: "https://connect.stripe.test/setup/acct_1" });
});

describe("createExpressAccount", () => {
  it("creates an Express account with the tutor's country", async () => {
    await createExpressAccount({ tutorId: "t-1", email: "tutor@example.com", country: "US" });

    const args = accountsCreate.mock.calls[0][0];
    expect(args.type).toBe("express");
    expect(args.country).toBe("US");
    expect(args.email).toBe("tutor@example.com");
  });

  it("requests the transfers capability (required for destination charges)", async () => {
    await createExpressAccount({ tutorId: "t-1", email: null, country: "GB" });

    const args = accountsCreate.mock.calls[0][0];
    expect(args.capabilities).toMatchObject({
      card_payments: { requested: true },
      transfers: { requested: true },
    });
  });

  it("tags the account with RoyalPal ownership metadata and the tutor id", async () => {
    await createExpressAccount({ tutorId: "t-1", email: null, country: "DE" });

    const args = accountsCreate.mock.calls[0][0];
    expect(args.metadata).toMatchObject({ app: "royalpal", platform: "royalpal", tutor_id: "t-1" });
  });

  it("omits email rather than sending null when none is available", async () => {
    await createExpressAccount({ tutorId: "t-1", email: null, country: "FR" });

    expect(accountsCreate.mock.calls[0][0].email).toBeUndefined();
  });

  it("returns the created account id", async () => {
    accountsCreate.mockResolvedValue({ id: "acct_specific" });

    const id = await createExpressAccount({ tutorId: "t-1", email: null, country: "US" });

    expect(id).toBe("acct_specific");
  });
});

describe("createOnboardingLink", () => {
  it("creates an account_onboarding link with both return and refresh URLs", async () => {
    await createOnboardingLink({
      accountId: "acct_1",
      returnUrl: "https://royalpal.test/tutor/payouts?connect=return",
      refreshUrl: "https://royalpal.test/tutor/payouts?connect=refresh",
    });

    const args = accountLinksCreate.mock.calls[0][0];
    expect(args.account).toBe("acct_1");
    expect(args.type).toBe("account_onboarding");
    expect(args.return_url).toContain("connect=return");
    expect(args.refresh_url).toContain("connect=refresh");
  });

  it("returns the hosted onboarding URL", async () => {
    accountLinksCreate.mockResolvedValue({ url: "https://connect.stripe.test/specific" });

    const url = await createOnboardingLink({
      accountId: "acct_1",
      returnUrl: "https://x/return",
      refreshUrl: "https://x/refresh",
    });

    expect(url).toBe("https://connect.stripe.test/specific");
  });
});
