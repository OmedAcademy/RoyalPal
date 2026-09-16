import "server-only";
import { getStripe } from "@/lib/stripe/client";
import { appMetadata } from "@/lib/stripe/app-metadata";

/**
 * Stripe Connect Express account creation and onboarding links.
 *
 * Destination charges (the locked architecture for RoyalPal) require the
 * connected account to have an active `transfers` capability, so it's
 * requested explicitly here rather than left to Express's default dashboard
 * flow. `country` is required by Stripe at account-creation time and is
 * immutable afterward — callers must have already confirmed the tutor has
 * one set (see lib/actions/stripe-connect.ts).
 *
 * Account objects are tagged with the same app/platform/environment
 * metadata as Checkout Sessions (lib/stripe/app-metadata.ts): the shared
 * Stripe account has no boundary between RoyalPal and its sibling product
 * other than metadata, and that must hold for Connect accounts too, not
 * just payment objects.
 */
export async function createExpressAccount(params: {
  tutorId: string;
  email: string | null;
  country: string;
}): Promise<string> {
  const account = await getStripe().accounts.create({
    type: "express",
    country: params.country,
    email: params.email ?? undefined,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: {
      ...appMetadata(),
      tutor_id: params.tutorId,
    },
  });

  return account.id;
}

/**
 * A single-use, short-lived hosted onboarding URL for a Connect account.
 * `refresh_url` is where Stripe sends the tutor back if the link itself
 * expired before they finished (not to be confused with re-onboarding
 * after a rejection) — the caller is expected to point both URLs at a page
 * that can regenerate a fresh link on demand, since this one can't be
 * reused.
 */
export async function createOnboardingLink(params: {
  accountId: string;
  returnUrl: string;
  refreshUrl: string;
}): Promise<string> {
  const link = await getStripe().accountLinks.create({
    account: params.accountId,
    return_url: params.returnUrl,
    refresh_url: params.refreshUrl,
    type: "account_onboarding",
  });

  return link.url;
}

/**
 * A single-use link into the tutor's Stripe Express dashboard, where they
 * can see their balance, payout schedule, and any outstanding
 * requirements.
 *
 * This is the correct destination for an ALREADY-ONBOARDED account.
 * Sending them back through `account_onboarding` instead would restart a
 * flow they have finished, and Stripe rejects that for a completed
 * account anyway.
 *
 * The URL expires quickly and is tied to one session, so it must never be
 * cached, stored, or emailed — always generate it on demand behind an
 * authenticated action.
 */
export async function createDashboardLink(accountId: string): Promise<string> {
  const link = await getStripe().accounts.createLoginLink(accountId);
  return link.url;
}
