import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";
import type { NotificationChannel as ChannelName } from "@/types/database";
import { OPTIONAL_CATEGORIES, type NotificationCategory } from "@/lib/notifications/types";

const log = logger.child({ component: "notification-preferences" });

const OPTIONAL = new Set<string>(OPTIONAL_CATEGORIES.map((c) => c.category));

/**
 * Whether a given channel may carry a given category for this user.
 *
 * Two rules, in this order:
 *
 *   1. A category that is not in OPTIONAL_CATEGORIES is transactional —
 *      account, security, support — and is ALWAYS delivered. There is no
 *      preference row that could suppress it, which is deliberate: "you can
 *      turn off the email telling you your password was changed" is not a
 *      setting, it is a vulnerability.
 *   2. Otherwise, preferences are opt-OUT rows (migration 0033). The absence
 *      of a row means enabled, so a brand-new user needs no seeding and a new
 *      category needs no backfill.
 *
 * Fails OPEN on a database error, and says so in the log. Losing a lesson
 * reminder because the preferences table hiccuped is worse than sending one
 * to somebody who muted it, and the mute is recoverable while the missed
 * lesson is not.
 */
export async function isChannelEnabled(params: {
  userId: string;
  channel: ChannelName;
  category: string;
}): Promise<boolean> {
  if (!OPTIONAL.has(params.category)) return true;

  try {
    const { data, error } = await createAdminClient()
      .from("notification_preferences")
      .select("enabled")
      .eq("user_id", params.userId)
      .eq("channel", params.channel)
      .eq("category", params.category)
      .maybeSingle();

    if (error) throw error;
    return data ? data.enabled : true;
  } catch (err) {
    log.error("preference lookup failed; delivering anyway", err, {
      channel: params.channel,
      category: params.category,
    });
    return true;
  }
}

export type PreferenceMap = Record<string, { email: boolean; push: boolean }>;

/** Every optional category's current state, for the settings screen. */
export async function getPreferences(userId: string): Promise<PreferenceMap> {
  const map: PreferenceMap = {};
  for (const { category } of OPTIONAL_CATEGORIES) {
    map[category] = { email: true, push: true };
  }

  const { data } = await createAdminClient()
    .from("notification_preferences")
    .select("channel, category, enabled")
    .eq("user_id", userId);

  for (const row of data ?? []) {
    const entry = map[row.category];
    if (entry && (row.channel === "email" || row.channel === "push")) {
      entry[row.channel] = row.enabled;
    }
  }
  return map;
}

export async function setPreference(params: {
  userId: string;
  channel: ChannelName;
  category: NotificationCategory;
  enabled: boolean;
}): Promise<void> {
  await createAdminClient().from("notification_preferences").upsert(
    {
      user_id: params.userId,
      channel: params.channel,
      category: params.category,
      enabled: params.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,channel,category" },
  );
}
