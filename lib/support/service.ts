import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NotificationService } from "@/lib/notifications/service";
import type { SupportCategory, SupportStatus } from "@/types/database";

export type TicketSummary = {
  id: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  lastMessageAt: string;
  createdAt: string;
  /** Present only on the admin queue. */
  requesterName?: string;
  requesterRole?: string;
  assignedAdminName?: string | null;
  messageCount?: number;
};

export type TicketMessage = {
  id: string;
  body: string;
  fromAdmin: boolean;
  senderName: string;
  createdAt: string;
};

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  account: "My account",
  booking: "A lesson or booking",
  payment: "Payments and refunds",
  technical: "Something is broken",
  report_user: "Report a person",
  safeguarding: "Safety concern",
  other: "Something else",
};

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_user: "Waiting on you",
  resolved: "Resolved",
  closed: "Closed",
};

export const SUPPORT_STATUS_STYLES: Record<SupportStatus, string> = {
  open: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  waiting_on_user: "bg-purple-100 text-purple-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-zinc-200 text-zinc-700",
};

/**
 * Categories that must never sit in a normal queue.
 *
 * A safeguarding report or a report about another user is not a support
 * request with a longer SLA — it is the one thing on this platform where a
 * delay is the harm. They are surfaced separately in the admin queue and are
 * the reason support_messages has no UPDATE or DELETE policy for anyone.
 * >>> The handling procedure behind this flag REQUIRES LEGAL REVIEW. <<<
 */
export const URGENT_CATEGORIES: SupportCategory[] = ["safeguarding", "report_user"];

/** The caller's own tickets (RLS-scoped). */
export async function listMyTickets(): Promise<TicketSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_tickets")
    .select("id, subject, category, status, last_message_at, created_at")
    .order("last_message_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((row) => ({
    id: row.id,
    subject: row.subject,
    category: row.category,
    status: row.status,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  }));
}

export async function getTicket(
  ticketId: string,
): Promise<{ ticket: TicketSummary; messages: TicketMessage[] } | null> {
  const supabase = await createClient();

  const { data: ticket } = await supabase
    .from("support_tickets")
    .select("id, subject, category, status, last_message_at, created_at")
    .eq("id", ticketId)
    .maybeSingle();

  // RLS makes "not yours" indistinguishable from "does not exist" here, which
  // is what the caller should see too.
  if (!ticket) return null;

  const { data: messages } = await supabase
    .from("support_messages")
    .select("id, body, from_admin, created_at, sender:profiles(full_name)")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })
    .limit(200);

  return {
    ticket: {
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status,
      lastMessageAt: ticket.last_message_at,
      createdAt: ticket.created_at,
    },
    messages: ((messages ?? []) as unknown as RawTicketMessage[]).map((row) => ({
      id: row.id,
      body: row.body,
      fromAdmin: row.from_admin,
      // Admin identities are not exposed to the requester; "RoyalPal Support"
      // is both friendlier and the correct amount of information.
      senderName: row.from_admin ? "RoyalPal Support" : (row.sender?.full_name ?? "You"),
      createdAt: row.created_at,
    })),
  };
}

type RawTicketMessage = {
  id: string;
  body: string;
  from_admin: boolean;
  created_at: string;
  sender: { full_name: string } | null;
};

/** The admin queue. Service role: an admin must see every ticket. */
export async function listAllTickets(filters: {
  status?: SupportStatus;
  category?: SupportCategory;
}): Promise<TicketSummary[]> {
  const admin = createAdminClient();
  let query = admin
    .from("support_tickets")
    .select(
      "id, subject, category, status, last_message_at, created_at, requester:profiles!support_tickets_user_id_fkey(full_name, role), assignee:profiles!support_tickets_assigned_admin_id_fkey(full_name)",
    )
    .order("last_message_at", { ascending: true })
    .limit(200);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.category) query = query.eq("category", filters.category);

  const { data } = await query;

  return ((data ?? []) as unknown as RawAdminTicket[]).map((row) => ({
    id: row.id,
    subject: row.subject,
    category: row.category,
    status: row.status,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    requesterName: row.requester?.full_name ?? "Unknown",
    requesterRole: row.requester?.role ?? "—",
    assignedAdminName: row.assignee?.full_name ?? null,
  }));
}

type RawAdminTicket = {
  id: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  last_message_at: string;
  created_at: string;
  requester: { full_name: string; role: string } | null;
  assignee: { full_name: string } | null;
};

/** Admin-side read of one ticket, including the requester's identity. */
export async function getTicketForAdmin(ticketId: string): Promise<{
  ticket: TicketSummary & { userId: string };
  messages: TicketMessage[];
} | null> {
  const admin = createAdminClient();

  const { data: ticket } = await admin
    .from("support_tickets")
    .select(
      "id, user_id, subject, category, status, last_message_at, created_at, requester:profiles!support_tickets_user_id_fkey(full_name, role)",
    )
    .eq("id", ticketId)
    .maybeSingle();

  if (!ticket) return null;

  const { data: messages } = await admin
    .from("support_messages")
    .select("id, body, from_admin, created_at, sender:profiles(full_name)")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })
    .limit(500);

  const requester = (ticket as unknown as { requester: { full_name: string; role: string } | null })
    .requester;

  return {
    ticket: {
      id: ticket.id,
      userId: ticket.user_id,
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status,
      lastMessageAt: ticket.last_message_at,
      createdAt: ticket.created_at,
      requesterName: requester?.full_name ?? "Unknown",
      requesterRole: requester?.role ?? "—",
    },
    messages: ((messages ?? []) as unknown as RawTicketMessage[]).map((row) => ({
      id: row.id,
      body: row.body,
      fromAdmin: row.from_admin,
      senderName: row.from_admin ? "RoyalPal Support" : (row.sender?.full_name ?? "Requester"),
      createdAt: row.created_at,
    })),
  };
}

/** Open-ticket count, for the admin nav badge. */
export async function openTicketCount(): Promise<number> {
  const { count } = await createAdminClient()
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "in_progress"]);
  return count ?? 0;
}

export async function notifyTicketReply(params: {
  userId: string;
  ticketId: string;
  subject: string;
}): Promise<void> {
  await NotificationService.emit({
    userId: params.userId,
    type: "support_reply",
    title: "Support replied to your request",
    body: params.subject,
    data: { href: `/support/${params.ticketId}` },
  });
}
