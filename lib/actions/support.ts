"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activeUserOrError, requireProfile } from "@/lib/supabase/queries";
import {
  createTicketSchema,
  ticketReplySchema,
  updateTicketSchema,
} from "@/lib/validations/support";
import {
  notifyAdminsOfTicketActivity,
  notifyTicketReply,
  URGENT_CATEGORIES,
} from "@/lib/support/service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/rate-limit/limiter";
import { NotificationService } from "@/lib/notifications/service";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ component: "support-action" });

export type SupportActionState = {
  error?: string;
  message?: string;
};

/**
 * Opens a support ticket and posts the first message.
 *
 * Two writes with no transaction between them, deliberately: a ticket with no
 * message is a recoverable annoyance (the requester sees an empty thread and
 * can add to it), whereas wrapping this in an RPC to make it atomic would move
 * the authorization out of RLS, where it is currently expressed once and
 * cannot be bypassed. The failure is logged so the imbalance is visible.
 */
export async function createTicket(
  _prevState: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const parsed = createTicketSchema.safeParse({
    category: formData.get("category"),
    subject: formData.get("subject"),
    body: formData.get("body"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  // A SUSPENDED user must still be able to contact support — appealing the
  // suspension is the one thing they need to do, and activeUserOrError
  // refuses them. So the check here is only "signed in".
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in" };
  if ("error" in auth && auth.error !== "Your account is suspended. Please contact support.") {
    return { error: auth.error };
  }

  const limit = await consumeRateLimit("createTicket", user.id);
  if (!limit.allowed) return { error: rateLimitMessage(limit) };

  const { data: ticket, error } = await supabase
    .from("support_tickets")
    .insert({
      user_id: user.id,
      category: parsed.data.category,
      subject: parsed.data.subject,
    })
    .select("id")
    .single();

  if (error || !ticket) {
    log.error("failed to create support ticket", error, { userId: user.id });
    return { error: "We couldn't open your request. Please try again." };
  }

  const { error: messageError } = await supabase.from("support_messages").insert({
    ticket_id: ticket.id,
    sender_id: user.id,
    from_admin: false,
    body: parsed.data.body,
  });

  if (messageError) {
    log.error("ticket created without its first message", messageError, { ticketId: ticket.id });
  }

  if (URGENT_CATEGORIES.includes(parsed.data.category)) {
    log.error("urgent support ticket opened", new Error("urgent_ticket"), {
      ticketId: ticket.id,
      category: parsed.data.category,
    });
  }

  revalidatePath("/support");
  redirect(`/support/${ticket.id}`);
}

/** A reply from the requester on their own ticket. */
export async function replyToTicket(
  _prevState: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const parsed = ticketReplySchema.safeParse({
    ticketId: formData.get("ticketId"),
    body: formData.get("body"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in" };

  const limit = await consumeRateLimit("ticketReply", user.id);
  if (!limit.allowed) return { error: rateLimitMessage(limit) };

  // from_admin is written as false unconditionally here. It is never derived
  // from the sender's role at read time (see migration 0031), and never
  // trusted from the form — a client-supplied "I am support" flag on a
  // support thread is an obvious impersonation primitive.
  const { error } = await supabase.from("support_messages").insert({
    ticket_id: parsed.data.ticketId,
    sender_id: user.id,
    from_admin: false,
    body: parsed.data.body,
  });

  if (error) {
    return { error: "That request is closed, so it can't take new replies." };
  }

  const admin = createAdminClient();

  const { data: ticket } = await admin
    .from("support_tickets")
    .select("id, subject, category")
    .eq("id", parsed.data.ticketId)
    .maybeSingle();

  // A reply from the requester moves a ticket that had LEFT the queue back
  // into it. `resolved` belongs in that set as much as `waiting_on_user` does:
  // the requester saying "this is still happening" is the plainest possible
  // statement that it was not resolved, and leaving the status alone hid the
  // message from every view an admin looks at. `closed` is absent because the
  // insert above cannot reach it — RLS refuses a message on a closed ticket,
  // so reopening is an admin action, as it should be.
  //
  // Conditional in the statement rather than on a status read a moment
  // earlier, so an admin picking the ticket up at the same instant is not
  // overwritten.
  const { data: reopened } = await admin
    .from("support_tickets")
    .update({ status: "open" })
    .eq("id", parsed.data.ticketId)
    .in("status", ["waiting_on_user", "resolved"])
    .select("id")
    .maybeSingle();

  if (ticket) {
    const urgent = URGENT_CATEGORIES.includes(ticket.category);
    // Urgent regardless of status: the queue sorts oldest-activity-first, so a
    // reply on an already-open safeguarding thread moves it further down the
    // list, not up it.
    if (urgent || reopened) {
      if (urgent) {
        log.error("reply on an urgent support ticket", new Error("urgent_ticket_reply"), {
          ticketId: ticket.id,
          category: ticket.category,
        });
      }
      await notifyAdminsOfTicketActivity({
        ticketId: ticket.id,
        subject: ticket.subject,
        urgent,
      });
    }
  }

  revalidatePath(`/support/${parsed.data.ticketId}`);
  revalidatePath("/admin/support");
  return { message: "Reply sent." };
}

/** An admin's reply. Runs through the service role and marks from_admin. */
export async function adminReplyToTicket(
  _prevState: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const profile = await requireProfile(["admin"]);

  const parsed = ticketReplySchema.safeParse({
    ticketId: formData.get("ticketId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const admin = createAdminClient();
  const { data: ticket } = await admin
    .from("support_tickets")
    .select("id, user_id, subject")
    .eq("id", parsed.data.ticketId)
    .maybeSingle();

  if (!ticket) return { error: "That ticket no longer exists." };

  const { error } = await admin.from("support_messages").insert({
    ticket_id: ticket.id,
    sender_id: profile.id,
    from_admin: true,
    body: parsed.data.body,
  });

  if (error) {
    log.error("admin reply failed", error, { ticketId: ticket.id });
    return { error: "Couldn't post that reply." };
  }

  await admin
    .from("support_tickets")
    .update({ status: "waiting_on_user", assigned_admin_id: profile.id })
    .eq("id", ticket.id);

  await notifyTicketReply({
    userId: ticket.user_id,
    ticketId: ticket.id,
    subject: ticket.subject,
  });

  revalidatePath(`/admin/support/${ticket.id}`);
  revalidatePath("/admin/support");
  return { message: "Reply sent." };
}

export async function updateTicketStatus(
  _prevState: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const profile = await requireProfile(["admin"]);

  const parsed = updateTicketSchema.safeParse({
    ticketId: formData.get("ticketId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: "Invalid request" };

  const admin = createAdminClient();
  const { data: ticket, error } = await admin
    .from("support_tickets")
    .update({ status: parsed.data.status, assigned_admin_id: profile.id })
    .eq("id", parsed.data.ticketId)
    .select("user_id, subject")
    .maybeSingle();

  if (error || !ticket) return { error: "Couldn't update that ticket." };

  if (parsed.data.status === "resolved") {
    await NotificationService.emit({
      userId: ticket.user_id,
      type: "support_reply",
      title: "Your support request was resolved",
      body: ticket.subject,
      data: { href: `/support/${parsed.data.ticketId}` },
    });
  }

  revalidatePath(`/admin/support/${parsed.data.ticketId}`);
  revalidatePath("/admin/support");
  return { message: `Marked ${parsed.data.status.replace("_", " ")}.` };
}
