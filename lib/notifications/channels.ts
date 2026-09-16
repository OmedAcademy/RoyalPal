import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailProvider } from "@/lib/notifications/email/provider";
import { renderEmail } from "@/lib/notifications/email/templates";

/**
 * A delivery channel beyond the always-on in-app feed. The service persists
 * every notification (in-app), then fans out to whichever secondary
 * channels are enabled. Adding SMS / push / WhatsApp later means adding one
 * object to `secondaryChannels` — no change to emit() or any business logic.
 */
export type DeliveryContext = {
  userId: string;
  type: string;
  title: string;
  body: string | null;
};

export interface NotificationChannel {
  readonly name: string;
  isEnabled(): boolean;
  deliver(ctx: DeliveryContext): Promise<void>;
}

const emailChannel: NotificationChannel = {
  name: "email",
  isEnabled() {
    return getEmailProvider().isEnabled();
  },
  async deliver(ctx) {
    // Resolve the recipient address from auth (emails live in auth.users,
    // never mirrored into a public table). Only reached when email is on.
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(ctx.userId);
    const to = data.user?.email;
    if (!to) return;

    const email = renderEmail(ctx.type, ctx.title, ctx.body ?? undefined);
    await getEmailProvider().send({
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  },
};

/**
 * Secondary channels, in delivery order. In-app is not here because it is
 * the primary persistence step in the service itself. Push/SMS/WhatsApp
 * providers append here in future.
 */
export const secondaryChannels: NotificationChannel[] = [emailChannel];
