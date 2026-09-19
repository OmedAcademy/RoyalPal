import Link from "next/link";
import type { Metadata } from "next";
import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { DeleteAccountPanel } from "@/components/settings/DeleteAccountPanel";
import { formatDate } from "@/lib/utils/format";
import { DELETION_GRACE_DAYS } from "@/lib/account/anonymize";

export const metadata: Metadata = { title: "Account settings — RoyalPal" };

export default async function AccountSettingsPage() {
  const profile = await requireProfile(["student", "tutor", "admin"]);
  const supabase = await createClient();

  const [{ data: authData }, { data: pendingDeletion }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("account_deletion_requests")
      .select("scheduled_for")
      .eq("user_id", profile.id)
      .is("cancelled_at", null)
      .is("completed_at", null)
      .maybeSingle(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div>
        <Link href="/settings" className="text-muted hover:text-foreground text-sm">
          ← Settings
        </Link>
        <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight">Account</h1>
      </div>

      <section className="border-hairline bg-surface flex flex-col gap-3 rounded-2xl border p-4">
        <div>
          <p className="text-muted text-sm">Email</p>
          <p className="font-medium">{authData.user?.email ?? "—"}</p>
        </div>
        <div>
          <p className="text-muted text-sm">Password</p>
          <p className="text-sm">
            <Link
              href="/forgot-password"
              className="text-royal font-medium underline underline-offset-4"
            >
              Send me a link to change it
            </Link>
          </p>
        </div>
        <p className="text-muted text-xs">
          Changing your email address isn&apos;t self-service yet — open a support request and
          we&apos;ll do it.
        </p>
      </section>

      <DeleteAccountPanel
        graceDays={DELETION_GRACE_DAYS}
        scheduledFor={
          pendingDeletion?.scheduled_for ? formatDate(pendingDeletion.scheduled_for) : null
        }
      />
    </div>
  );
}
