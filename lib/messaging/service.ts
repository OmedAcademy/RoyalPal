import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NotificationService } from "@/lib/notifications/service";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ component: "messaging" });

export type ConversationSummary = {
  id: string;
  bookingId: string;
  status: "open" | "closed";
  closedReason: string | null;
  /** The OTHER party, from the caller's point of view. */
  counterpartId: string;
  counterpartName: string;
  counterpartAvatarUrl: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  lessonStartAt: string;
  lessonStatus: string;
  subjectName: string | null;
};

export type MessageDTO = {
  id: string;
  body: string;
  senderId: string;
  mine: boolean;
  readAt: string | null;
  createdAt: string;
};

/**
 * Creates the conversation for a booking.
 *
 * Called from createBooking, through the service role, because migration 0032
 * gives clients no INSERT policy: a client that could create a conversation
 * could assert the student-tutor relationship that the whole booking-scoped
 * design depends on existing beforehand.
 *
 * Best-effort by contract, exactly like NotificationService.emit — a
 * messaging failure must never roll back a lesson someone is paying for. The
 * booking is the product; the thread is an affordance on top of it.
 */
export async function ensureConversationForBooking(params: {
  bookingId: string;
  studentId: string;
  tutorId: string;
}): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("conversations")
      .upsert(
        {
          booking_id: params.bookingId,
          student_id: params.studentId,
          tutor_id: params.tutorId,
        },
        { onConflict: "booking_id" },
      )
      .select("id")
      .maybeSingle();

    if (error) throw error;
    return data?.id ?? null;
  } catch (err) {
    log.error("failed to create conversation", err, { bookingId: params.bookingId });
    return null;
  }
}

/** The caller's threads, newest activity first. RLS scopes the rows. */
export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .select(
      `id, booking_id, student_id, tutor_id, status, closed_reason, last_message_at,
       bookings!inner(start_at, status, subjects(name)),
       student:profiles!conversations_student_id_fkey(id, full_name, avatar_url),
       tutor:profiles!conversations_tutor_id_fkey(id, full_name, avatar_url)`,
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) {
    log.error("failed to list conversations", error, { userId });
    return [];
  }

  const rows = (data ?? []) as unknown as RawConversationRow[];
  if (rows.length === 0) return [];

  const [unreadByConversation, previewByConversation] = await Promise.all([
    unreadCountsFor(
      rows.map((r) => r.id),
      userId,
    ),
    lastMessagePreviews(rows.map((r) => r.id)),
  ]);

  return rows.map((row) => {
    const viewerIsStudent = row.student_id === userId;
    const counterpart = viewerIsStudent ? row.tutor : row.student;
    return {
      id: row.id,
      bookingId: row.booking_id,
      status: row.status,
      closedReason: row.closed_reason,
      counterpartId: counterpart?.id ?? "",
      counterpartName: counterpart?.full_name ?? "RoyalPal user",
      counterpartAvatarUrl: counterpart?.avatar_url ?? null,
      lastMessageAt: row.last_message_at,
      lastMessagePreview: previewByConversation.get(row.id) ?? null,
      unreadCount: unreadByConversation.get(row.id) ?? 0,
      lessonStartAt: row.bookings.start_at,
      lessonStatus: row.bookings.status,
      subjectName: row.bookings.subjects?.name ?? null,
    };
  });
}

type RawConversationRow = {
  id: string;
  booking_id: string;
  student_id: string;
  tutor_id: string;
  status: "open" | "closed";
  closed_reason: string | null;
  last_message_at: string | null;
  bookings: { start_at: string; status: string; subjects: { name: string } | null };
  student: { id: string; full_name: string; avatar_url: string | null } | null;
  tutor: { id: string; full_name: string; avatar_url: string | null } | null;
};

/**
 * Unread counts for a set of threads, in ONE query.
 *
 * "Unread" means: not sent by me, and never marked read. Counting per
 * conversation in a loop is the N+1 that makes an inbox slow the moment it is
 * useful, so this fetches the unread rows for every listed thread at once and
 * tallies in memory. Bounded by the `.limit(100)` on the conversation list
 * above and by the partial index messages_unread_idx.
 */
async function unreadCountsFor(
  conversationIds: string[],
  userId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (conversationIds.length === 0) return counts;

  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("conversation_id")
    .in("conversation_id", conversationIds)
    .neq("sender_id", userId)
    .is("read_at", null);

  for (const row of data ?? []) {
    counts.set(row.conversation_id, (counts.get(row.conversation_id) ?? 0) + 1);
  }
  return counts;
}

async function lastMessagePreviews(conversationIds: string[]): Promise<Map<string, string>> {
  const previews = new Map<string, string>();
  if (conversationIds.length === 0) return previews;

  const supabase = await createClient();
  // Ordered oldest-last so the final write per conversation wins the map.
  const { data } = await supabase
    .from("messages")
    .select("conversation_id, body, created_at")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: true })
    .limit(1000);

  for (const row of data ?? []) {
    previews.set(row.conversation_id, row.body.slice(0, 140));
  }
  return previews;
}

/** Total unread across every thread — the badge in the navigation. */
export async function unreadMessageCount(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .neq("sender_id", userId)
    .is("read_at", null);
  return count ?? 0;
}

export async function getConversation(
  conversationId: string,
  userId: string,
): Promise<{ conversation: ConversationSummary; messages: MessageDTO[] } | null> {
  const conversations = await listConversations(userId);
  const conversation = conversations.find((c) => c.id === conversationId);
  if (!conversation) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("id, body, sender_id, read_at, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);

  const messages: MessageDTO[] = (data ?? []).map((row) => ({
    id: row.id,
    body: row.body,
    senderId: row.sender_id,
    mine: row.sender_id === userId,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));

  return { conversation, messages };
}

/**
 * Marks everything the OTHER party sent as read.
 *
 * The `.neq("sender_id", userId)` mirrors the RLS policy rather than relying
 * on it: the policy already refuses to let anyone mark their own message read
 * on the recipient's behalf, and a filter that matches it means the statement
 * updates nothing instead of being refused outright.
 */
export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .neq("sender_id", userId)
    .is("read_at", null);
}

/** Notifies the recipient that a message arrived. Never throws. */
export async function notifyNewMessage(params: {
  recipientId: string;
  senderName: string;
  body: string;
  href: string;
}): Promise<void> {
  await NotificationService.emit({
    userId: params.recipientId,
    type: "message_received",
    title: `New message from ${params.senderName}`,
    body: params.body.slice(0, 140),
    data: { href: params.href },
  });
}
