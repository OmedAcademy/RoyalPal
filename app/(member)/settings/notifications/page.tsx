import Link from "next/link";
import type { Metadata } from "next";
import { requireProfile } from "@/lib/supabase/queries";
import { getPreferences } from "@/lib/notifications/preferences";
import { createClient } from "@/lib/supabase/server";
import { OPTIONAL_CATEGORIES } from "@/lib/notifications/types";
import { PreferenceToggle } from "@/components/settings/PreferenceToggle";
import { DeviceList } from "@/components/settings/DeviceList";
import { getEmailProvider } from "@/lib/notifications/email/provider";

export const metadata: Metadata = { title: "Notification settings — RoyalPal" };

export default async function NotificationSettingsPage() {
  const profile = await requireProfile(["student", "tutor", "admin"]);
  const supabase = await createClient();

  const [preferences, { data: devices }] = await Promise.all([
    getPreferences(profile.id),
    supabase
      .from("push_tokens")
      .select("token, platform, device_name, last_seen_at")
      .eq("user_id", profile.id)
      .is("disabled_at", null)
      .order("last_seen_at", { ascending: false }),
  ]);

  const emailConfigured = getEmailProvider().isEnabled();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div>
        <Link href="/settings" className="text-muted hover:text-foreground text-sm">
          ← Settings
        </Link>
        <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-muted mt-1 text-sm">
          These control optional updates. Security and account messages — a password change, a
          suspension, a reply from support — are always sent.
        </p>
      </div>

      {!emailConfigured && (
        <p
          role="status"
          className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
        >
          Email delivery isn&apos;t switched on for this deployment yet, so email settings are saved
          but nothing is sent by email.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">What to send</h2>
        <ul className="border-hairline bg-surface divide-y divide-[color:var(--hairline)] overflow-hidden rounded-2xl border">
          {OPTIONAL_CATEGORIES.map((category) => (
            <li key={category.category} className="flex flex-col gap-3 p-4">
              <div>
                <p className="font-medium">{category.label}</p>
                <p className="text-muted text-sm">{category.description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <PreferenceToggle
                  category={category.category}
                  channel="email"
                  label="Email"
                  enabled={preferences[category.category]?.email ?? true}
                />
                <PreferenceToggle
                  category={category.category}
                  channel="push"
                  label="Push"
                  enabled={preferences[category.category]?.push ?? true}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Your devices</h2>
        <p className="text-muted text-sm">
          Devices that have the RoyalPal app installed and notifications turned on.
        </p>
        <DeviceList
          devices={(devices ?? []).map((d) => ({
            token: d.token,
            platform: d.platform,
            deviceName: d.device_name,
            lastSeenAt: d.last_seen_at,
          }))}
        />
      </section>
    </div>
  );
}
