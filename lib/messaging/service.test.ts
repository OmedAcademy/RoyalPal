import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * Thread loading — MSG-1 (which end of the thread is loaded, and how the rest
 * is reached) and MSG-2 (whether a thread can be opened at all).
 *
 * These are the two failures a user hits first and reports last, because both
 * look like "the app lost my messages" rather than like a bug: one silently
 * shows the oldest page of a long conversation, the other 404s a thread that
 * demonstrably exists.
 */

const STUDENT = "11111111-1111-4111-8111-111111111111";
const TUTOR = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.client }));
vi.mock("@/lib/notifications/service", () => ({
  NotificationService: { emit: vi.fn(), emitMany: vi.fn() },
}));

const { getConversation, listConversations, unreadMessageCount, MESSAGE_PAGE_SIZE } =
  await import("@/lib/messaging/service");

/** A conversation row shaped the way PostgREST returns it, embeds included. */
function conversation(id: string, lastMessageAt: string | null, preview: string | null = null) {
  return {
    last_message_preview: preview,
    id,
    booking_id: `booking-${id}`,
    student_id: STUDENT,
    tutor_id: TUTOR,
    status: "open",
    closed_reason: null,
    last_message_at: lastMessageAt,
    bookings: {
      start_at: "2026-01-01T10:00:00.000Z",
      status: "confirmed",
      subjects: { name: "Maths" },
    },
    student: { id: STUDENT, full_name: "Ada", avatar_url: null },
    tutor: { id: TUTOR, full_name: "Grace", avatar_url: null },
  };
}

/** `count` messages in `conversationId`, one per minute, oldest first.
 * `startDay` shifts the whole run, so one thread can be strictly newer than
 * another — which is what decides who wins a shared cap. */
function messages(conversationId: string, count: number, startDay = 1) {
  const base = Date.UTC(2026, 0, startDay, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => ({
    id: `m${String(i).padStart(4, "0")}`,
    conversation_id: conversationId,
    body: `message ${i}`,
    sender_id: i % 2 === 0 ? STUDENT : TUTOR,
    read_at: "2026-01-01T00:00:00.000Z",
    created_at: new Date(base + i * 60_000).toISOString(),
  }));
}

beforeEach(() => {
  fake = createFakeSupabase({ conversations: [], messages: [] }, { id: STUDENT });
});

describe("getConversation — which end of the thread loads (MSG-1)", () => {
  const LONG = 600;

  function seedLongThread() {
    fake = createFakeSupabase(
      {
        conversations: [conversation("c1", "2026-01-01T09:59:00.000Z")],
        messages: messages("c1", LONG),
      },
      { id: STUDENT },
    );
  }

  it("loads the NEWEST page of a long thread, not the oldest", async () => {
    // The composer keeps accepting messages regardless of how long the thread
    // is. Loading the oldest page means everything a user sends past that
    // point is invisible to both of them — the thread looks frozen in the past
    // while still silently accepting new messages.
    seedLongThread();

    const result = await getConversation("c1", STUDENT);

    expect(result).not.toBeNull();
    const bodies = result!.messages.map((m) => m.body);
    expect(bodies).toContain(`message ${LONG - 1}`);
    expect(bodies).not.toContain("message 0");
  });

  it("returns that page oldest-first, the order a transcript reads in", async () => {
    seedLongThread();

    const result = await getConversation("c1", STUDENT);
    const times = result!.messages.map((m) => m.createdAt);

    expect(times).toEqual([...times].sort());
  });

  it("says older messages remain and hands back a cursor to reach them", async () => {
    seedLongThread();

    const result = await getConversation("c1", STUDENT);

    expect(result!.hasMore).toBe(true);
    expect(result!.nextCursor).toBe(result!.messages[0].createdAt);
  });

  it("pages backwards from the cursor onto the block immediately older", async () => {
    seedLongThread();

    const first = await getConversation("c1", STUDENT);
    const second = await getConversation("c1", STUDENT, { before: first!.nextCursor! });

    const newestOfSecond = second!.messages.at(-1)!.createdAt;
    expect(newestOfSecond < first!.messages[0].createdAt).toBe(true);
    expect(second!.messages).toHaveLength(MESSAGE_PAGE_SIZE);
    // No gap and no overlap between the two pages.
    const ids = new Set(second!.messages.map((m) => m.id));
    expect(first!.messages.some((m) => ids.has(m.id))).toBe(false);
  });

  it("reports no further pages for a thread shorter than one page", async () => {
    fake = createFakeSupabase(
      {
        conversations: [conversation("c1", "2026-01-01T00:02:00.000Z")],
        messages: messages("c1", 3),
      },
      { id: STUDENT },
    );

    const result = await getConversation("c1", STUDENT);

    expect(result!.messages).toHaveLength(3);
    expect(result!.hasMore).toBe(false);
    expect(result!.nextCursor).toBeNull();
  });
});

describe("getConversation — whether the thread opens at all (MSG-2)", () => {
  it("opens a thread that sorts past the hundredth most recent", async () => {
    // Resolving a single thread by scanning a capped list makes the cap a
    // visibility limit: the 101st thread does not 404 because it is missing,
    // it 404s because nobody looked far enough.
    const rows = Array.from({ length: 150 }, (_, i) =>
      conversation(`c${i}`, new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString()),
    );
    fake = createFakeSupabase(
      { conversations: rows, messages: messages("c0", 2) },
      { id: STUDENT },
    );

    // c0 has the OLDEST last_message_at, so it sorts last of 150.
    const result = await getConversation("c0", STUDENT);

    expect(result).not.toBeNull();
    expect(result!.conversation.id).toBe("c0");
  });

  it("opens a brand-new thread that has no messages yet", async () => {
    // last_message_at is null until someone speaks, and nulls sort last — so
    // the thread for a lesson booked one second ago is the single least
    // reachable thread in the inbox, which is precisely backwards.
    fake = createFakeSupabase(
      { conversations: [conversation("fresh", null)], messages: [] },
      { id: STUDENT },
    );

    const result = await getConversation("fresh", STUDENT);

    expect(result).not.toBeNull();
    expect(result!.messages).toEqual([]);
    expect(result!.hasMore).toBe(false);
  });

  it("still refuses someone who is not a participant", async () => {
    // RLS is the real boundary, but the query is no longer filtered by the
    // caller's own conversation list, so the check has to be explicit here
    // too rather than emergent.
    fake = createFakeSupabase(
      { conversations: [conversation("c1", null)], messages: [] },
      { id: STRANGER },
    );

    expect(await getConversation("c1", STRANGER)).toBeNull();
  });
});

describe("listConversations — the line under each name (MSG-3)", () => {
  it("shows each thread's newest message however long the threads are", async () => {
    // The preview used to be computed from ONE capped query across every
    // listed thread, ordered oldest-first. Past the cap it failed from the
    // wrong end: the busiest threads — the ones at the top of the inbox — got
    // no preview at all, while quiet old ones showed months-old text.
    const busy = conversation("busy", "2026-02-01T00:00:00.000Z", "the newest thing said");
    const quiet = conversation("quiet", "2026-01-01T00:00:00.000Z", "hello from january");

    fake = createFakeSupabase(
      {
        conversations: [busy, quiet],
        // 1200 in the quiet thread, every one of them OLDER than the busy
        // thread's three. Ordered oldest-first and capped at 1000, the old
        // query never reached the busy thread at all — and the busy thread is
        // the one at the top of the inbox.
        messages: [...messages("quiet", 1200, 1), ...messages("busy", 3, 40)],
      },
      { id: STUDENT },
    );

    const { conversations } = await listConversations(STUDENT);
    const byId = new Map(conversations.map((c) => [c.id, c.lastMessagePreview]));

    expect(byId.get("busy")).toBe("the newest thing said");
    expect(byId.get("quiet")).toBe("hello from january");
  });
});

describe("unreadMessageCount — whose messages it counts (MSG-4)", () => {
  it("asks the database rather than counting whatever rows RLS exposes", async () => {
    // With no participant predicate the count leaned entirely on RLS scope.
    // For an admin that scope is every message on the platform, so the badge
    // in their navigation counted other people's conversations.
    fake = createFakeSupabase(
      { conversations: [], messages: messages("someone-elses-thread", 500) },
      { id: STUDENT },
      { rpc: { unread_message_count: 3 } },
    );

    expect(await unreadMessageCount(STUDENT)).toBe(3);
    expect(fake.rpcCalls.map((c) => c.name)).toContain("unread_message_count");
  });

  it("reports zero rather than a wrong number when the call fails", async () => {
    fake = createFakeSupabase({ conversations: [], messages: [] }, { id: STUDENT });

    expect(await unreadMessageCount(STUDENT)).toBe(0);
  });
});
