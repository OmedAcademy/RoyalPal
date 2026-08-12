"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeUserOrError } from "@/lib/supabase/queries";
import {
  createDashboardLink,
  createExpressAccount,
  createOnboardingLink,
} from "@/lib/stripe/connect";
import { isStripeConfigured } from "@/lib/stripe/client";
import { stripeCountryFor } from "@/lib/stripe/connect-country";
import { logger } from "@/lib/observability/logger";

export type ConnectActionState = { error?: string };

const log = logger.child({ component: "stripe-connect-action" });

/**
 * Starts (or resumes) Stripe Express onboarding for the signed-in tutor and
 * redirects them to Stripe's hosted flow. Reuses an existing
 * tutor_profiles.stripe_account_id if one was already created — Stripe
 * Account objects are not disposable, so a tutor who abandons onboarding
 * and comes back gets a fresh link for the *same* account rather than a
 * second one.
 *
 * The account-id write uses the request-scoped RLS client, not the
 * service-role client: this is the tutor updating their own row, which
 * tutor_profiles_update_own_or_admin already permits, and it's account
 * linkage rather than a financial ledger write.
 */
export async function startTutorOnboarding(
  _prevState: ConnectActionState,
  _formData: FormData,
): Promise<ConnectActionState> {
  // Checked before any DB work: without credentials there is nothing to
  // onboard TO, and reporting that plainly beats a generic failure that
  // looks like a Stripe outage.
  if (!isStripeConfigured()) {
    return { error: "Payouts aren't available yet. Please check back soon." };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) {
    return { error: auth.error };
  }
  const userId = auth.user.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, country")
    .eq("id", userId)
    .maybeSingle();

  if (!profile || profile.role !== "tutor") {
    return { error: "Only tutors can connect a payout account" };
  }
  if (!profile.country) {
    return { error: "Add your country in your profile before connecting payouts" };
  }

  // profiles.country holds a display name; Stripe needs ISO alpha-2. Resolved
  // here rather than inside createExpressAccount so an unmappable country
  // fails with a message the tutor can act on, instead of becoming a generic
  // Stripe rejection.
  const country = stripeCountryFor(profile.country);
  if (!country.ok) {
    log.error("could not resolve a Stripe country", undefined, {
      tutorId: userId,
      reason: country.reason,
    });
    return {
      error: "We couldn't match your country to a payout region. Please contact support.",
    };
  }

  const { data: tutorProfile } = await supabase
    .from("tutor_profiles")
    .select("stripe_account_id")
    .eq("id", userId)
    .maybeSingle();

  if (!tutorProfile) {
    return { error: "Complete your tutor profile before connecting payouts" };
  }

  let accountId = tutorProfile.stripe_account_id;

  if (!accountId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    try {
      accountId = await createExpressAccount({
        tutorId: userId,
        email: user?.email ?? null,
        country: country.code,
      });
    } catch (err) {
      log.error("failed to create Connect account", err, { tutorId: userId });
      return { error: "Could not start onboarding. Please try again." };
    }

    const { error: updateError } = await supabase
      .from("tutor_profiles")
      .update({ stripe_account_id: accountId })
      .eq("id", userId);

    if (updateError) {
      log.error("failed to persist stripe_account_id", updateError, { tutorId: userId, accountId });
      return { error: "Could not start onboarding. Please try again." };
    }

    log.info("connect account created", { tutorId: userId, accountId });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let onboardingUrl: string;
  try {
    onboardingUrl = await createOnboardingLink({
      accountId,
      returnUrl: `${appUrl}/tutor/payouts?connect=return`,
      refreshUrl: `${appUrl}/tutor/payouts?connect=refresh`,
    });
  } catch (err) {
    log.error("failed to create onboarding link", err, { tutorId: userId, accountId });
    return { error: "Could not start onboarding. Please try again." };
  }

  redirect(onboardingUrl);
}

/**
 * Sends an onboarded tutor into their Stripe Express dashboard.
 *
 * Separate from startTutorOnboarding because the two are not
 * interchangeable: onboarding links are for accounts that still need to
 * submit details, login links are for accounts that already have. Using
 * the wrong one either restarts a finished flow or is rejected by Stripe
 * outright.
 *
 * The account id is read from the caller's OWN tutor_profiles row — never
 * accepted as a parameter — so this cannot be used to mint a dashboard
 * link into somebody else's Stripe account.
 */
export async function openStripeDashboard(
  _prevState: ConnectActionState,
  _formData: FormData,
): Promise<ConnectActionState> {
  if (!isStripeConfigured()) {
    return { error: "Payouts aren't available yet. Please check back soon." };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) {
    return { error: auth.error };
  }
  const userId = auth.user.id;

  const { data: tutorProfile } = await supabase
    .from("tutor_profiles")
    .select("stripe_account_id")
    .eq("id", userId)
    .maybeSingle();

  if (!tutorProfile?.stripe_account_id) {
    return { error: "Connect a payout account first" };
  }

  let url: string;
  try {
    url = await createDashboardLink(tutorProfile.stripe_account_id);
  } catch (err) {
    log.error("failed to create dashboard link", err, { tutorId: userId });
    return { error: "Could not open your Stripe dashboard. Please try again." };
  }

  redirect(url);
}
