import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailProvider } from "@/lib/notifications/email/provider";
import { renderEmail } from "@/lib/notifications/email/templates";
import { isChannelEnabled } from "@/lib/notifications/preferences";
import { sendPush } from "@/lib/notifications/push";

/**
 * A delivery channel beyond the always-on in-app feed. The service persists
 * every notification (in-app), then fans out to whichever secondary channels
 * are enabled. Adding SMS / WhatsApp later means adding one object to
 * `secondaryChannels` — no change to emit() or any business logic.
 *
 * `category` rides along so each channel can consult the user's preferences
 * (migration 0033) before delivering. The preference check lives in the
 * channel rather than in emit() on purpose: a user who has muted lesson email
 * may still want the push, and vice versa, so the decision is per channel.
 */
export type DeliveryContext = {
  userId: string;
  type: string;
  category: string;
  title: string;
  body: string | null;
  href: string | null;
};

export interface NotificationChannel {
  readonly name: string;
  /** Whether the channel is configured at all, for the whole deployment. */
  isEnabled(): boolean;
  deliver(ctx: DeliveryContext): Promise<void>;
}

const emailChannel: NotificationChannel = {
  name: "email",
  isEnabled() {
    return getEmailProvider().isEnabled();
  },
  async deliver(ctx) {
    if (!(await isChannelEnabled({ userId: ctx.userId, channel: "email", category: ctx.category })))
      return;

    // Resolve the recipient address from auth (emails live in auth.users,
    // never mirrored into a public table). Only reached when email is on.
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(ctx.userId);
    const to = data.user?.email;
    if (!to) return;

    const email = renderEmail(ctx.type, ctx.title, ctx.body ?? undefined, ctx.href ?? undefined);
    await getEmailProvider().send({
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  },
};

const pushChannel: NotificationChannel = {
  name: "push",
  isEnabled() {
    // Expo's unauthenticated tier needs no configuration, so this channel is
    // always on for the deployment; whether a given user receives anything
    // depends on whether they have registered a device at all.
    return true;
  },
  async deliver(ctx) {
    if (!(await isChannelEnabled({ userId: ctx.userId, channel: "push", category: ctx.category })))
      return;

    await sendPush(ctx.userId, {
      title: ctx.title,
      body: ctx.body,
      href: ctx.href ?? undefined,
    });
  },
};

/**
 * Secondary channels, in delivery order. In-app is not here because it is
 * the primary persistence step in the service itself.
 */
export const secondaryChannels: NotificationChannel[] = [emailChannel, pushChannel];
