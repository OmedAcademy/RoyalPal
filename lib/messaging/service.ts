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

export type ConversationListPage = {
  conversations: ConversationSummary[];
  page: number;
  pageSize: number;
  /** Total threads the caller can see, so a UI can say "1-25 of 137". */
  total: number;
  hasMore: boolean;
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

// `profiles!conversations_*_fkey` disambiguates the two paths from a
// conversation to a profile; `bookings!inner` because a thread without its
// lesson has nothing to show.
const CONVERSATION_SELECT = `id, booking_id, student_id, tutor_id, status, closed_reason, last_message_at,
       bookings!inner(start_at, status, subjects(name)),
       student:profiles!conversations_student_id_fkey(id, full_name, avatar_url),
       tutor:profiles!conversations_tutor_id_fkey(id, full_name, avatar_url)`;

/** Threads per page in the inbox. */
export const CONVERSATION_PAGE_SIZE = 25;
const MAX_CONVERSATION_PAGE_SIZE = 100;

function toSummary(
  row: RawConversationRow,
  userId: string,
  preview: string | null,
  unreadCount: number,
): ConversationSummary {
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
    lastMessagePreview: preview,
    unreadCount,
    lessonStartAt: row.bookings.start_at,
    lessonStatus: row.bookings.status,
    subjectName: row.bookings.subjects?.name ?? null,
  };
}

/**
 * The caller's threads, newest activity first. RLS scopes the rows.
 *
 * Paged rather than capped. A hard `.limit(100)` is not a safety limit, it is
 * a silent truncation: the hundred-and-first thread stops existing as far as
 * the inbox is concerned, with nothing anywhere saying so — and for a tutor
 * who teaches daily that is a matter of months, not years.
 */
export async function listConversations(
  userId: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<ConversationListPage> {
  const supabase = await createClient();

  const pageSize = Math.min(
    Math.max(opts.pageSize ?? CONVERSATION_PAGE_SIZE, 1),
    MAX_CONVERSATION_PAGE_SIZE,
  );
  const page = Math.max(opts.page ?? 0, 0);
  const from = page * pageSize;

  const { data, error, count } = await supabase
    .from("conversations")
    .select(CONVERSATION_SELECT, { count: "exact" })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .range(from, from + pageSize - 1);

  if (error) {
    log.error("failed to list conversations", error, { userId });
    return { conversations: [], page, pageSize, total: 0, hasMore: false };
  }

  const rows = (data ?? []) as unknown as RawConversationRow[];
  const total = count ?? rows.length;
  if (rows.length === 0) {
    return { conversations: [], page, pageSize, total, hasMore: false };
  }

  const ids = rows.map((r) => r.id);
  const [unreadByConversation, previewByConversation] = await Promise.all([
    unreadCountsFor(ids, userId),
    lastMessagePreviews(ids),
  ]);

  return {
    conversations: rows.map((row) =>
      toSummary(
        row,
        userId,
        previewByConversation.get(row.id) ?? null,
        unreadByConversation.get(row.id) ?? 0,
      ),
    ),
    page,
    pageSize,
    total,
    hasMore: from + rows.length < total,
  };
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

/** Messages per page in a thread. */
export const MESSAGE_PAGE_SIZE = 50;
const MAX_MESSAGE_PAGE_SIZE = 200;

export type ConversationPage = {
  conversation: ConversationSummary;
  /** Oldest-first within the page, the order a transcript reads in. */
  messages: MessageDTO[];
  /** Whether messages OLDER than this page exist. */
  hasMore: boolean;
  /** The oldest loaded message's timestamp; pass it back as `before`. */
  nextCursor: string | null;
};

/**
 * One thread, plus the newest page of it.
 *
 * Two things this deliberately does NOT do any more.
 *
 * It does not resolve the conversation by scanning the caller's thread list,
 * which made that list's page size a visibility limit: a thread past it, and
 * every brand-new thread — `last_message_at` is null until someone speaks, and
 * nulls sort last — answered 404 while plainly existing.
 *
 * And it does not load the OLDEST messages. `ascending: true` with a cap reads
 * as "the first N", but a conversation is consumed from its end: past the cap
 * the thread appeared frozen while the composer went on accepting messages
 * that neither party could see. Fetch newest-first, reverse for display, and
 * hand back a cursor for the rest.
 */
export async function getConversation(
  conversationId: string,
  userId: string,
  opts: { before?: string; pageSize?: number } = {},
): Promise<ConversationPage | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_SELECT)
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    log.error("failed to load conversation", error, { conversationId, userId });
    return null;
  }

  const row = data as unknown as RawConversationRow | null;
  if (!row) return null;
  // RLS is the real boundary and already hides a non-participant's row. This
  // repeats it rather than depending on it: the query is no longer filtered
  // through the caller's own list, so the check has to be stated to survive a
  // future policy edit.
  if (row.student_id !== userId && row.tutor_id !== userId) return null;

  const pageSize = Math.min(Math.max(opts.pageSize ?? MESSAGE_PAGE_SIZE, 1), MAX_MESSAGE_PAGE_SIZE);

  // One row over the page size: the cheapest honest answer to "is there more",
  // with no second count query.
  let query = supabase
    .from("messages")
    .select("id, body, sender_id, read_at, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);

  // Keyset, not offset: a thread grows at the end while it is being read, and
  // an offset would shift under every message that arrives mid-scroll.
  if (opts.before) query = query.lt("created_at", opts.before);

  const { data: messageRows, error: messageError } = await query;
  if (messageError) {
    log.error("failed to load messages", messageError, { conversationId, userId });
    return null;
  }

  const newestFirst = messageRows ?? [];
  const hasMore = newestFirst.length > pageSize;
  const messages: MessageDTO[] = (hasMore ? newestFirst.slice(0, pageSize) : newestFirst)
    .map((r) => ({
      id: r.id,
      body: r.body,
      senderId: r.sender_id,
      mine: r.sender_id === userId,
      readAt: r.read_at,
      createdAt: r.created_at,
    }))
    .reverse();

  const [unread, preview] = await Promise.all([
    unreadCountsFor([conversationId], userId),
    // Asked for directly rather than derived from the page above: when reading
    // an older page, the page's last message is not the thread's last message.
    lastMessagePreview(conversationId),
  ]);

  return {
    conversation: toSummary(row, userId, preview, unread.get(conversationId) ?? 0),
    messages,
    hasMore,
    nextCursor: hasMore && messages.length > 0 ? messages[0].createdAt : null,
  };
}

/** The newest message in one thread, for its summary line. */
async function lastMessagePreview(conversationId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("body")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1);

  const body = data?.[0]?.body;
  return typeof body === "string" ? body.slice(0, 140) : null;
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
