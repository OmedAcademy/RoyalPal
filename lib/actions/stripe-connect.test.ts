import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * Tutor Connect onboarding — the entry point that creates (or reuses) a
 * Stripe Express account for a tutor and sends them to hosted onboarding.
 *
 * Priority order, matching booking.test.ts's approach:
 *   1. Authorization: only a signed-in, non-suspended tutor with a country
 *      and a completed tutor profile may start onboarding.
 *   2. No duplicate accounts: a tutor who already has stripe_account_id
 *      gets a fresh link for the SAME account, never a second Account.
 *   3. Failure isolation: a Stripe error surfaces a generic message and
 *      never leaks Stripe's own error text to the client.
 */

const TUTOR = "11111111-1111-4111-8111-111111111111";

let fake: ReturnType<typeof createFakeSupabase>;
const createExpressAccount = vi.fn();
const createOnboardingLink = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("@/lib/stripe/connect", () => ({
  createExpressAccount: (...a: unknown[]) => createExpressAccount(...a),
  createOnboardingLink: (...a: unknown[]) => createOnboardingLink(...a),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

const { startTutorOnboarding } = await import("@/lib/actions/stripe-connect");

/** Runs an action that ends in redirect(), returning the redirect target. */
async function captureRedirect(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as { url?: string }).url ?? null;
  }
}

function seed(
  opts: {
    role?: "tutor" | "student";
    country?: string | null;
    hasTutorProfile?: boolean;
    stripeAccountId?: string | null;
    user?: string | null;
  } = {},
) {
  const role = opts.role ?? "tutor";
  const hasTutorProfile = opts.hasTutorProfile ?? true;

  fake = createFakeSupabase(
    {
      profiles: [
        {
          id: TUTOR,
          role,
          country: opts.country === undefined ? "US" : opts.country,
          status: "active",
        },
      ],
      tutor_profiles: hasTutorProfile
        ? [
            {
              id: TUTOR,
              stripe_account_id: opts.stripeAccountId === undefined ? null : opts.stripeAccountId,
            },
          ]
        : [],
    },
    opts.user === undefined ? { id: TUTOR } : opts.user ? { id: opts.user } : null,
  );
}

beforeEach(() => {
  seed();
  createExpressAccount.mockReset();
  createOnboardingLink.mockReset();
  createExpressAccount.mockResolvedValue("acct_new");
  createOnboardingLink.mockResolvedValue("https://connect.stripe.test/setup/acct_new");
});

describe("startTutorOnboarding — authorization", () => {
  it("refuses when the caller is not signed in", async () => {
    seed({ user: null });
    const res = await startTutorOnboarding({}, new FormData());

    expect(res.error).toBe("You must be signed in");
    expect(createExpressAccount).not.toHaveBeenCalled();
  });

  it("refuses a non-tutor caller", async () => {
    seed({ role: "student" });
    const res = await startTutorOnboarding({}, new FormData());

    expect(res.error).toBe("Only tutors can connect a payout account");
    expect(createExpressAccount).not.toHaveBeenCalled();
  });

  it("refuses when the tutor has no country set", async () => {
    seed({ country: null });
    const res = await startTutorOnboarding({}, new FormData());

    expect(res.error).toBe("Add your country in your profile before connecting payouts");
    expect(createExpressAccount).not.toHaveBeenCalled();
  });

  it("refuses when the tutor profile isn't set up yet", async () => {
    seed({ hasTutorProfile: false });
    const res = await startTutorOnboarding({}, new FormData());

    expect(res.error).toBe("Complete your tutor profile before connecting payouts");
    expect(createExpressAccount).not.toHaveBeenCalled();
  });
});

describe("startTutorOnboarding — account creation", () => {
  it("creates a new Express account and persists the id when none exists yet", async () => {
    const url = await captureRedirect(() => startTutorOnboarding({}, new FormData()));

    expect(createExpressAccount).toHaveBeenCalledTimes(1);
    expect(createExpressAccount.mock.calls[0][0]).toMatchObject({
      tutorId: TUTOR,
      country: "US",
    });
    expect(fake.db.tutor_profiles[0].stripe_account_id).toBe("acct_new");
    expect(url).toBe("https://connect.stripe.test/setup/acct_new");
  });

  it("passes both return_url and refresh_url to the onboarding link", async () => {
    await captureRedirect(() => startTutorOnboarding({}, new FormData()));

    const args = createOnboardingLink.mock.calls[0][0];
    expect(args.returnUrl).toContain("connect=return");
    expect(args.refreshUrl).toContain("connect=refresh");
  });

  it("reuses an existing Stripe account instead of creating a second one", async () => {
    seed({ stripeAccountId: "acct_existing" });

    const url = await captureRedirect(() => startTutorOnboarding({}, new FormData()));

    expect(createExpressAccount).not.toHaveBeenCalled();
    expect(createOnboardingLink).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acct_existing" }),
    );
    expect(url).toBe("https://connect.stripe.test/setup/acct_new");
  });
});

describe("startTutorOnboarding — failure isolation", () => {
  it("returns a generic error and never leaks Stripe's error text when account creation fails", async () => {
    createExpressAccount.mockRejectedValue(new Error("Stripe: invalid business_type for country"));

    const res = await startTutorOnboarding({}, new FormData());

    expect(res.error).toBe("Could not start onboarding. Please try again.");
    expect(res.error).not.toContain("business_type");
    expect(fake.db.tutor_profiles[0].stripe_account_id).toBeNull();
  });

  it("returns a generic error when the onboarding link fails, without creating a duplicate account on retry", async () => {
    createOnboardingLink.mockRejectedValue(new Error("Stripe: rate limited"));

    const res = await startTutorOnboarding({}, new FormData());

    expect(res.error).toBe("Could not start onboarding. Please try again.");
    // The account was still created and persisted before the link call, so
    // a retry reuses it via the "existing account" path above rather than
    // creating a second one.
    expect(fake.db.tutor_profiles[0].stripe_account_id).toBe("acct_new");
  });
});
