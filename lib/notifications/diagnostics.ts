import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailProvider } from "@/lib/notifications/email/provider";
import { renderEmail } from "@/lib/notifications/email/templates";
import { sendPush } from "@/lib/notifications/push";
import { secondaryChannels } from "@/lib/notifications/channels";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ component: "notification-diagnostics" });

export type ChannelStatus = {
  channel: string;
  /** Configured for the deployment as a whole. */
  configured: boolean;
  detail: string;
};

export type ProbeResult = {
  channel: string;
  ok: boolean;
  detail: string;
};

/**
 * What the deployment can actually deliver, right now.
 *
 * Every secondary channel is dormant until its credentials exist, and the
 * service swallows delivery failures by contract so a broken mailbox can never
 * fail a booking. Those two correct decisions together mean a misconfigured
 * deployment looks exactly like a working one from the outside: notifications
 * appear in the in-app feed and simply never arrive anywhere else.
 *
 * This is the page that tells an operator which it is, before a student finds
 * out by missing a lesson.
 */
export function describeChannels(): ChannelStatus[] {
  const email = getEmailProvider();
  const statuses: ChannelStatus[] = [
    {
      channel: "in-app",
      configured: true,
      detail: "Always on. Written to the notifications table by the service role.",
    },
    {
      channel: "email",
      configured: email.isEnabled(),
      detail: email.isEnabled()
        ? `Provider: ${email.name}. RESEND_API_KEY and EMAIL_FROM_ADDRESS are both set.`
        : `Provider: ${email.name}, dormant. Set RESEND_API_KEY and EMAIL_FROM_ADDRESS to switch it on — no code change is needed.`,
    },
    {
      channel: "push",
      configured: true,
      detail: process.env.EXPO_ACCESS_TOKEN
        ? "Expo push, authenticated (EXPO_ACCESS_TOKEN set). Delivery still depends on the recipient having registered a device."
        : "Expo push, unauthenticated tier — works without a key. Setting EXPO_ACCESS_TOKEN is recommended in production: it stops anyone who obtains a token from sending to it.",
    },
  ];

  // Cross-check against the channel registry rather than restating it, so a
  // channel added to channels.ts and forgotten here shows up as unknown
  // instead of silently missing from the page.
  for (const channel of secondaryChannels) {
    if (!statuses.some((status) => status.channel === channel.name)) {
      statuses.push({
        channel: channel.name,
        configured: channel.isEnabled(),
        detail: "Registered in channels.ts but not described in diagnostics.ts.",
      });
    }
  }

  return statuses;
}

/** How many devices this account could receive a push on. */
export async function pushTokenCountFor(userId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("push_tokens")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    // Disabled tokens are kept (they are evidence of a device that existed),
    // so the column to filter on is the timestamp, not a boolean.
    .is("disabled_at", null);

  if (error) {
    log.error("failed to count push tokens", error, { userId });
    return 0;
  }
  return count ?? 0;
}

/**
 * Sends a test through each channel to the CALLER'S OWN account and reports
 * what happened, per channel, including the provider's error text.
 *
 * Deliberately NOT routed through emit(). emit is best-effort by contract — it
 * catches and logs so a notification problem can never break the booking that
 * triggered it — which is exactly the wrong behaviour for a diagnostic: the
 * error text is the entire output.
 *
 * Deliberately self-only. A "send a test to any user" control is a spam
 * primitive with an admin badge on it; the recipient is always the signed-in
 * admin, and the caller cannot name anyone else.
 */
export async function sendSelfTest(userId: string): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const title = "RoyalPal delivery test";
  const body = "If you are reading this, this channel works. Sent from Admin → Delivery.";

  const admin = createAdminClient();

  // 1. In-app.
  const { error: insertError } = await admin.from("notifications").insert({
    user_id: userId,
    type: "delivery_test",
    category: "system",
    title,
    body,
    data: { href: "/admin/delivery" },
  });
  results.push({
    channel: "in-app",
    ok: !insertError,
    detail: insertError ? insertError.message : "Written. Check the bell.",
  });

  // 2. Email — straight at the provider, bypassing the preference check, so a
  //    muted category cannot be mistaken for a broken mailbox.
  const email = getEmailProvider();
  if (!email.isEnabled()) {
    results.push({
      channel: "email",
      ok: false,
      detail: "Not configured — nothing was sent. Set RESEND_API_KEY and EMAIL_FROM_ADDRESS.",
    });
  } else {
    const { data } = await admin.auth.admin.getUserById(userId);
    const to = data.user?.email;
    if (!to) {
      results.push({ channel: "email", ok: false, detail: "No address on this account." });
    } else {
      try {
        const rendered = renderEmail("delivery_test", title, body, "/admin/delivery");
        await email.send({
          to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        results.push({
          channel: "email",
          ok: true,
          detail: `Accepted by ${email.name} for ${to}.`,
        });
      } catch (err) {
        results.push({
          channel: "email",
          ok: false,
          detail: err instanceof Error ? err.message : "Unknown failure.",
        });
      }
    }
  }

  // 3. Push.
  const tokens = await pushTokenCountFor(userId);
  if (tokens === 0) {
    results.push({
      channel: "push",
      ok: false,
      detail:
        "No registered devices on this account. Sign in to the mobile app and accept the notification prompt, then try again.",
    });
  } else {
    try {
      await sendPush(userId, { title, body, href: "/notifications" });
      results.push({
        channel: "push",
        ok: true,
        detail: `Accepted by Expo for ${tokens} device${tokens === 1 ? "" : "s"}. Expo answers before the device does, so a green result here means accepted, not delivered.`,
      });
    } catch (err) {
      results.push({
        channel: "push",
        ok: false,
        detail: err instanceof Error ? err.message : "Unknown failure.",
      });
    }
  }

  return results;
}
