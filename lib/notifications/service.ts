import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { secondaryChannels } from "@/lib/notifications/channels";
import { metaFor, type NotificationDTO, type NotificationInput } from "@/lib/notifications/types";
import { logger } from "@/lib/observability/logger";
import type { Json } from "@/types/database";

/**
 * The single entry point for every notification in RoyalPal. Business logic
 * calls `emit`; it never touches the notifications table or email directly.
 *
 * Writes go through the service-role client (there is no client INSERT
 * policy), so any server context — Server Action or Stripe webhook — can
 * notify any user. Reads and read/delete mutations use the request-scoped
 * RLS client, so a user can only ever see or change their own rows.
 *
 * emit is best-effort by contract: it swallows and logs failures so a
 * notification problem can never break the booking or payment flow that
 * triggered it.
 */

const log = logger.child({ component: "notification-service" });

async function persistAndDispatch(input: NotificationInput): Promise<void> {
  const { category } = metaFor(input.type);
  const admin = createAdminClient();

  const { error } = await admin.from("notifications").insert({
    user_id: input.userId,
    type: input.type,
    category,
    title: input.title,
    body: input.body ?? null,
    // The payload is a plain, JSON-serializable object; assert it as Json for
    // the jsonb column (the NotificationData index signature is `unknown`).
    data: (input.data ?? {}) as unknown as Json,
  });

  if (error) {
    log.error("failed to persist notification", error, { type: input.type, userId: input.userId });
    return;
  }

  // Fan out to enabled secondary channels (email and push; SMS later).
  // Each channel applies the user's per-category preference itself — see
  // lib/notifications/channels.ts for why that decision is not made here.
  const href = typeof input.data?.href === "string" ? input.data.href : null;
  await Promise.allSettled(
    secondaryChannels
      .filter((c) => c.isEnabled())
      .map((c) =>
        c
          .deliver({
            userId: input.userId,
            type: input.type,
            category,
            title: input.title,
            body: input.body ?? null,
            href,
          })
          .catch((err) =>
            log.error("channel delivery failed", err, { channel: c.name, type: input.type }),
          ),
      ),
  );
}

function toDTO(row: {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string | null;
  data: unknown;
  read_at: string | null;
  created_at: string;
}): NotificationDTO {
  const data = (row.data ?? {}) as { href?: string };
  return {
    id: row.id,
    type: row.type,
    icon: metaFor(row.type).icon,
    category: row.category,
    title: row.title,
    body: row.body,
    href: typeof data.href === "string" ? data.href : null,
    read: row.read_at !== null,
    createdAt: row.created_at,
  };
}

export const NotificationService = {
  /** Create and dispatch one notification. Never throws. */
  async emit(input: NotificationInput): Promise<void> {
    try {
      await persistAndDispatch(input);
    } catch (err) {
      log.error("emit failed", err, { type: input.type, userId: input.userId });
    }
  },

  /** Create and dispatch many (e.g. notify both parties). Never throws. */
  async emitMany(inputs: NotificationInput[]): Promise<void> {
    await Promise.allSettled(inputs.map((i) => this.emit(i)));
  },

  /** The current user's recent notifications (RLS-scoped). */
  async list(limit = 20): Promise<NotificationDTO[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("notifications")
      .select("id, type, category, title, body, data, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map(toDTO);
  },

  /** Count of the current user's unread notifications (RLS-scoped). */
  async unreadCount(): Promise<number> {
    const supabase = await createClient();
    const { count } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .is("read_at", null);
    return count ?? 0;
  },

  /** Mark one of the current user's notifications read (RLS enforces owner). */
  async markAsRead(id: string): Promise<void> {
    const supabase = await createClient();
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .is("read_at", null);
  },

  /** Mark all of the current user's notifications read. */
  async markAllAsRead(): Promise<void> {
    const supabase = await createClient();
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
  },

  /** Delete one of the current user's notifications. */
  async delete(id: string): Promise<void> {
    const supabase = await createClient();
    await supabase.from("notifications").delete().eq("id", id);
  },
};
