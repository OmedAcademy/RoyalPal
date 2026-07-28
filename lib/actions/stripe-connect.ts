"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeUserOrError } from "@/lib/supabase/queries";
import { createExpressAccount, createOnboardingLink } from "@/lib/stripe/connect";
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
        country: profile.country,
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
