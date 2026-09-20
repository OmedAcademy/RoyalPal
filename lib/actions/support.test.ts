import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * replyToTicket — SUP-4.
 *
 * The failure this covers is not that a reply is rejected. It is that a reply
 * is ACCEPTED and then reaches nobody: RLS blocks only `closed`, so a message
 * lands on a resolved ticket, the ticket stays resolved, the urgent list on
 * the admin queue filters resolved out, and the queue's oldest-activity-first
 * ordering sends the freshly-touched row to the bottom. On a safeguarding
 * thread that is the one category where a delay is itself the harm.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ADMIN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TICKET = "77777777-7777-4777-8777-777777777777";

let fake: ReturnType<typeof createFakeSupabase>;
const emitted: { userId: string; type: string; data?: { href?: string } }[] = [];

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.client }));
vi.mock("@/lib/rate-limit/limiter", () => ({
  consumeRateLimit: async () => ({ allowed: true }),
  rateLimitMessage: () => "Too many requests",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/notifications/service", () => ({
  NotificationService: {
    emit: async (input: { userId: string; type: string; data?: { href?: string } }) => {
      emitted.push(input);
    },
    emitMany: async (inputs: { userId: string; type: string; data?: { href?: string } }[]) => {
      emitted.push(...inputs);
    },
  },
}));

const { replyToTicket } = await import("@/lib/actions/support");

function seed(opts: { status: string; category?: string }) {
  fake = createFakeSupabase(
    {
      profiles: [
        { id: USER, role: "student", status: "active" },
        { id: ADMIN_A, role: "admin", status: "active" },
        { id: ADMIN_B, role: "admin", status: "active" },
      ],
      support_tickets: [
        {
          id: TICKET,
          user_id: USER,
          subject: "I need help",
          category: opts.category ?? "account",
          status: opts.status,
        },
      ],
      support_messages: [],
    },
    { id: USER },
  );
}

function form(body = "Following up — this is still happening.") {
  const fd = new FormData();
  fd.set("ticketId", TICKET);
  fd.set("body", body);
  return fd;
}

const ticketStatus = () => fake.db.support_tickets[0].status;
const adminNotices = () => emitted.filter((n) => n.userId === ADMIN_A || n.userId === ADMIN_B);

beforeEach(() => {
  emitted.length = 0;
});

describe("replyToTicket — a reply must land somewhere someone looks", () => {
  it("puts a resolved ticket back in the queue", async () => {
    seed({ status: "resolved" });

    const res = await replyToTicket({}, form());

    expect(res.error).toBeUndefined();
    expect(fake.db.support_messages).toHaveLength(1);
    expect(ticketStatus()).toBe("open");
  });

  it("still reopens a ticket that was waiting on the user", async () => {
    seed({ status: "waiting_on_user" });

    await replyToTicket({}, form());

    expect(ticketStatus()).toBe("open");
  });

  it("leaves an in-progress ticket alone — an admin already has it", async () => {
    seed({ status: "in_progress" });

    await replyToTicket({}, form());

    expect(ticketStatus()).toBe("in_progress");
  });
});

describe("replyToTicket — who hears about it", () => {
  it("tells every admin when a resolved safeguarding ticket is replied to", async () => {
    seed({ status: "resolved", category: "safeguarding" });

    await replyToTicket({}, form());

    const notices = adminNotices();
    expect(notices.map((n) => n.userId).sort()).toEqual([ADMIN_A, ADMIN_B]);
    // Deep-links to the admin view of the ticket, not the requester's.
    expect(notices[0].data?.href).toBe(`/admin/support/${TICKET}`);
  });

  it("tells every admin when an ordinary resolved ticket is reopened", async () => {
    seed({ status: "resolved" });

    await replyToTicket({}, form());

    expect(adminNotices()).toHaveLength(2);
  });

  it("tells every admin about a safeguarding reply even on an open ticket", async () => {
    // Urgent means urgent. The queue sorts by oldest activity, so a reply on
    // an already-open safeguarding thread moves DOWN the list, not up.
    seed({ status: "open", category: "safeguarding" });

    await replyToTicket({}, form());

    expect(adminNotices()).toHaveLength(2);
  });

  it("stays quiet on an ordinary reply to a ticket already in the queue", async () => {
    // Every reply notifying every admin would train them to ignore the ones
    // that matter.
    seed({ status: "open" });

    await replyToTicket({}, form());

    expect(adminNotices()).toHaveLength(0);
  });

  it("does not notify a suspended admin account", async () => {
    seed({ status: "resolved", category: "safeguarding" });
    fake.db.profiles.find((p) => p.id === ADMIN_B)!.status = "suspended";

    await replyToTicket({}, form());

    expect(adminNotices().map((n) => n.userId)).toEqual([ADMIN_A]);
  });
});
