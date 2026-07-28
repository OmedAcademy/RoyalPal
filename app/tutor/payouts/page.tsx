import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { ConnectOnboardingButton } from "@/components/tutor/ConnectOnboardingButton";

/**
 * Doubles as both the Account Link return_url and refresh_url target (see
 * lib/actions/stripe-connect.ts): after either a completed attempt or an
 * expired link, the tutor lands here and sees their real current status,
 * not a static "thanks" page. stripe_charges_enabled is only ever flipped
 * true by the account.updated webhook (a later milestone) — until then this
 * page correctly shows "pending" even immediately after onboarding, since
 * the return redirect fires before Stripe has necessarily sent that event.
 */
export default async function TutorPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>;
}) {
  const profile = await requireProfile(["tutor"]);
  const { connect } = await searchParams;
  const supabase = await createClient();

  const { data: tutorProfile } = await supabase
    .from("tutor_profiles")
    .select("stripe_account_id, stripe_charges_enabled")
    .eq("id", profile.id)
    .maybeSingle();

  const status: "not_connected" | "pending" | "active" = !tutorProfile?.stripe_account_id
    ? "not_connected"
    : tutorProfile.stripe_charges_enabled
      ? "active"
      : "pending";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Payouts</h1>

      {connect === "return" && status !== "active" && (
        <p className="border-hairline bg-surface text-muted rounded-lg border px-4 py-3 text-sm">
          Thanks — we&apos;re verifying your details with Stripe. This can take a few minutes; the
          status below will update automatically once it&apos;s confirmed.
        </p>
      )}
      {connect === "refresh" && (
        <p className="border-hairline bg-surface text-muted rounded-lg border px-4 py-3 text-sm">
          That onboarding link expired before you finished. Start it again below.
        </p>
      )}

      <Card title="Stripe Connect status">
        {status === "active" && (
          <p className="text-sm">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">Connected.</span>{" "}
            Your payouts are active — lesson earnings are transferred to your account
            automatically after each payment.
          </p>
        )}

        {status === "pending" && (
          <div className="flex flex-col gap-3">
            <p className="text-muted text-sm">
              Your Stripe account has been created but onboarding isn&apos;t complete yet. Finish
              it to start receiving payouts.
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
