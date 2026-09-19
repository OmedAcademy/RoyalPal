import { requireProfile } from "@/lib/supabase/queries";
import { isStripeConfigured } from "@/lib/stripe/client";
import { hasPausedBankPayouts, resolvePayoutStatus } from "@/lib/stripe/account-status";
import { Card } from "@/components/ui/Card";
import { ConnectOnboardingButton } from "@/components/tutor/ConnectOnboardingButton";
import { StripeDashboardButton } from "@/components/tutor/StripeDashboardButton";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Doubles as both the Account Link return_url and refresh_url target (see
 * lib/actions/stripe-connect.ts): after either a completed attempt or an
 * expired link, the tutor lands here and sees their real current status
 * rather than a static "thanks" page.
 *
 * Every status below is derived from columns the account.updated webhook
 * mirrors from Stripe — never from the return redirect, which fires before
 * Stripe has necessarily finished verifying anything.
 */

/** Stripe's requirement keys are machine-readable ("individual.id_number");
 * this makes them merely unpleasant rather than incomprehensible. Deliberately
 * not an exhaustive mapping — the list changes, and a readable fallback beats
 * a stale dictionary. */
function humanizeRequirement(key: string): string {
  return key
    .replace(/^individual\./, "")
    .replace(/^company\./, "")
    .replace(/_/g, " ")
    .replace(/\bid\b/g, "ID");
}

export default async function TutorPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>;
}) {
  const profile = await requireProfile(["tutor"]);
  const { connect } = await searchParams;
  // Service role, not the request client: migration 0041 revokes SELECT on the
  // Stripe columns from `authenticated`, because a policy that shares a tutor's
  // headline cannot also be allowed to share their connected-account id. This
  // page is the tutor reading their OWN payout state, so it is scoped to the
  // id requireProfile just authorized — the privilege buys column access, not
  // a wider row.
  const { data: tutorProfile } = await createAdminClient()
    .from("tutor_profiles")
    .select(
      "stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_requirements_due, stripe_disabled_reason",
    )
    .eq("id", profile.id)
    .maybeSingle();

  const status = resolvePayoutStatus(isStripeConfigured(), tutorProfile);
  const requirements = tutorProfile?.stripe_requirements_due ?? [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Payouts</h1>

      {connect === "return" && status !== "active" && (
        <p
          role="status"
          className="border-hairline bg-surface text-muted rounded-lg border px-4 py-3 text-sm"
        >
          Thanks — we&apos;re verifying your details with Stripe. This can take a few minutes; the
          status below updates automatically once it&apos;s confirmed.
        </p>
      )}
      {connect === "refresh" && (
        <p
          role="status"
          className="border-hairline bg-surface text-muted rounded-lg border px-4 py-3 text-sm"
        >
          That onboarding link expired before you finished. Start it again below.
        </p>
      )}

      <Card title="Stripe Connect status">
        {status === "unconfigured" && (
          <p className="text-muted text-sm">
            Payouts aren&apos;t available on this environment yet. Nothing is wrong with your
            account — the platform&apos;s payment provider isn&apos;t connected. Check back soon.
          </p>
        )}

        {status === "active" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              <span className="font-medium text-emerald-700 dark:text-emerald-400">Connected.</span>{" "}
              Your payouts are active — lesson earnings are transferred to your account
              automatically after each payment.
            </p>
            {hasPausedBankPayouts(tutorProfile) && (
              // charges_enabled and payouts_enabled are genuinely separate:
              // you can be earning while bank payouts are paused.
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Note: bank payouts are currently paused on your Stripe account, so earnings are
                collecting in your Stripe balance rather than reaching your bank.
              </p>
            )}
            <StripeDashboardButton />
          </div>
        )}

        {status === "verifying" && (
          <div className="flex flex-col gap-3">
            <p className="text-muted text-sm">
              Stripe is reviewing the details you submitted. This usually takes a few minutes but
              can take longer. No action is needed from you right now.
            </p>
            <StripeDashboardButton />
          </div>
        )}

        {status === "restricted" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-red-700 dark:text-red-400">
              Stripe needs more information before you can be paid.
            </p>
            {requirements.length > 0 && (
              <div className="text-muted text-sm">
                <p className="mb-1">Outstanding:</p>
                <ul className="list-inside list-disc">
                  {requirements.map((r) => (
                    <li key={r}>{humanizeRequirement(r)}</li>
                  ))}
                </ul>
              </div>
            )}
            <ConnectOnboardingButton label="Resolve with Stripe" />
          </div>
        )}

        {status === "incomplete" && (
          <div className="flex flex-col gap-3">
            <p className="text-muted text-sm">
              Your Stripe account has been created but onboarding isn&apos;t complete yet. Finish it
              to start receiving payouts.
            </p>
            <ConnectOnboardingButton label="Continue onboarding" />
          </div>
        )}

        {status === "not_connected" && (
          <div className="flex flex-col gap-3">
            <p className="text-muted text-sm">
              Connect a Stripe account to receive payouts for your lessons. RoyalPal keeps a
              platform fee from each payment; the rest is transferred to you automatically.
            </p>
            {!profile.country && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Add your country in your profile before connecting payouts.
              </p>
            )}
            <ConnectOnboardingButton label="Connect with Stripe" />
          </div>
        )}
      </Card>
    </div>
  );
}
