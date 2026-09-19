import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";
import type { PushPlatform } from "@/types/database";

const log = logger.child({ component: "push" });

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Push delivery through Expo's service, which fronts both APNs and FCM.
 *
 * WHY EXPO AND NOT APNs/FCM DIRECTLY
 * Talking to Apple and Google directly means an APNs signing key and an FCM
 * service-account JSON living in the server environment, two different
 * payload shapes, two token formats, and two sets of error semantics — before
 * a single notification is delivered. Expo's endpoint takes one payload for
 * both platforms and, critically for this codebase, needs NO secret at all
 * for the unauthenticated tier: the ExpoPushToken itself is the capability.
 * EXPO_ACCESS_TOKEN is supported below and is worth setting in production
 * (it stops anyone who obtains a token from sending to it), but its absence
 * does not stop push from working.
 *
 * Swapping this for direct APNs/FCM later means reimplementing sendPush and
 * nothing else — the token table, the preference check and every caller are
 * provider-agnostic.
 */
export function isPushConfigured(): boolean {
  // Deliberately always true: the unauthenticated tier needs no configuration.
  // This function exists so a future provider that DOES need keys has a
  // single place to say so, matching isStripeConfigured's role.
  return true;
}

export type PushMessage = {
  title: string;
  body: string | null;
  /** Deep-link path, consumed by the mobile app's linking config. */
  href?: string;
  badge?: number;
};

type ExpoTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

/**
 * Registers (or re-claims) a device token.
 *
 * Upsert on `token`, not insert: when one person signs out of a shared device
 * and another signs in, the provider hands out the SAME token to the new
 * account. Inserting would leave both rows alive and the previous user's
 * lesson reminders would land on the new user's lock screen. Claiming the
 * token moves it, which is the only correct outcome.
 */
export async function registerPushToken(params: {
  userId: string;
  token: string;
  platform: PushPlatform;
  deviceName?: string | null;
}): Promise<void> {
  const { error } = await createAdminClient()
    .from("push_tokens")
    .upsert(
      {
        user_id: params.userId,
        token: params.token,
        platform: params.platform,
        device_name: params.deviceName ?? null,
        disabled_at: null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );

  if (error) {
    log.error("failed to register push token", error, { userId: params.userId });
    throw error;
  }
}

export async function unregisterPushToken(token: string): Promise<void> {
  await createAdminClient().from("push_tokens").delete().eq("token", token);
}

/** Every live token for a user. Disabled tokens are excluded, not deleted. */
async function activeTokensFor(userId: string): Promise<string[]> {
  const { data } = await createAdminClient()
    .from("push_tokens")
    .select("token")
    .eq("user_id", userId)
    .is("disabled_at", null);
  return (data ?? []).map((row) => row.token);
}

/**
 * A token the provider has told us is dead is marked, not deleted.
 *
 * Deleting makes the failure vanish; marking makes it countable. "How many of
 * our users have no working device?" is a question worth being able to answer
 * before a launch, and it is unanswerable from an empty table.
 */
async function disableTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await createAdminClient()
    .from("push_tokens")
    .update({ disabled_at: new Date().toISOString() })
    .in("token", tokens);
}

export async function sendPush(userId: string, message: PushMessage): Promise<void> {
  const tokens = await activeTokensFor(userId);
  if (tokens.length === 0) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  const payload = tokens.map((to) => ({
    to,
    title: message.title,
    body: message.body ?? undefined,
    // `data` is what the app reads on tap to route to the right screen.
    data: message.href ? { href: message.href } : {},
    badge: message.badge,
    sound: "default" as const,
  }));

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Expo push responded ${response.status}: ${await response.text()}`);
  }

  // Expo answers 200 with PER-MESSAGE tickets, so a successful HTTP status
  // says nothing about whether anything was delivered. DeviceNotRegistered is
  // the one that matters: it means the app was uninstalled or the token was
  // rotated, and continuing to send to it is how a token table fills with
  // garbage that slows every future send.
  const result = (await response.json()) as { data?: ExpoTicket[] };
  const dead: string[] = [];
  (result.data ?? []).forEach((ticket, index) => {
    if (ticket.status === "error") {
      if (ticket.details?.error === "DeviceNotRegistered") {
        dead.push(tokens[index]);
      } else {
        log.error("push ticket error", new Error(ticket.message ?? "unknown"), {
          expoError: ticket.details?.error,
        });
      }
    }
  });
  await disableTokens(dead);
}
