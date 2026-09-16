/**
 * The single definition of "what does this tutor's Connect state mean".
 *
 * Two surfaces ask the question — the payouts page and the dashboard banner
 * — and they must never disagree: a dashboard saying "all good" above a
 * payouts page saying "restricted" is worse than either alone. Keeping the
 * decision here also makes it testable, which it is not while it lives
 * inside a React Server Component (this project has no component test
 * harness).
 *
 * Deliberately dependency-free and side-effect-free: no Stripe call, no DB
 * call. It reads mirrored state that the account.updated webhook wrote.
 */

export type PayoutStatus =
  | "unconfigured" // the deployment has no Stripe credentials at all
  | "not_connected" // tutor has never started onboarding
  | "incomplete" // started, but Stripe still wants details
  | "verifying" // details submitted, Stripe still reviewing
  | "restricted" // Stripe actively blocked the account
  | "active"; // charges enabled

/**
 * Every field is optional-by-type on purpose. Migration 0026 may not be
 * applied yet, in which case these columns are absent from the row rather
 * than `false` — and "absent" must not be read as "disabled", which would
 * assert a problem we have no evidence for.
 */
export type ConnectAccountState = {
  stripe_account_id?: string | null;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
  stripe_details_submitted?: boolean | null;
  stripe_disabled_reason?: string | null;
};

export function resolvePayoutStatus(
  stripeConfigured: boolean,
  account: ConnectAccountState | null | undefined,
): PayoutStatus {
  if (!stripeConfigured) return "unconfigured";
  if (!account?.stripe_account_id) return "not_connected";

  // Restriction outranks everything else. An account can be charges_enabled
  // AND restricted at the same time (Stripe often allows charges up to a
  // future deadline), and the deadline is the thing worth saying.
  if (account.stripe_disabled_reason) return "restricted";

  if (account.stripe_charges_enabled) return "active";
  if (account.stripe_details_submitted) return "verifying";
  return "incomplete";
}

/**
 * True when a tutor is earning normally but their money is stuck in Stripe
 * rather than reaching a bank. Distinct from every status above — the
 * account is healthy by any other measure, which is exactly why this is
 * easy to miss.
 *
 * Requires an explicit `false`: absent (pre-0026) is not "paused".
 */
export function hasPausedBankPayouts(account: ConnectAccountState | null | undefined): boolean {
  return Boolean(account?.stripe_charges_enabled) && account?.stripe_payouts_enabled === false;
}

/**
 * Which dashboard banner (if any) a tutor should see.
 *
 * `null` means stay silent. This is the important case: a banner that is
 * always present is a banner nobody reads, so a healthy account gets
 * nothing at all.
 *
 * Lives here rather than inside the component so the decision is unit
 * testable and cannot drift from the payouts page — the two surfaces
 * previously each carried their own conditionals, which is precisely how a
 * dashboard ends up saying "all good" above a payouts page saying
 * "restricted".
 */
export type PayoutBanner =
  "restricted" | "not_connected" | "incomplete" | "verifying" | "payouts_paused";

export function payoutBannerFor(
  stripeConfigured: boolean,
  account: ConnectAccountState | null | undefined,
): PayoutBanner | null {
  const status = resolvePayoutStatus(stripeConfigured, account);

  switch (status) {
    // Nothing to nag a tutor about: the platform has no Stripe configured,
    // which is our problem, not theirs. Telling them to "connect Stripe"
    // would send them into a flow that cannot succeed.
    case "unconfigured":
      return null;

    case "restricted":
      return "restricted";
    case "not_connected":
      return "not_connected";
    case "incomplete":
      return "incomplete";
    case "verifying":
      return "verifying";

    case "active":
      // Healthy and earning — silent, UNLESS the money is piling up in
      // Stripe instead of reaching a bank, which looks fine everywhere else.
      return hasPausedBankPayouts(account) ? "payouts_paused" : null;
  }
}
