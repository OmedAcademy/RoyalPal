import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, as, createUser, user, serviceRole, type Db } from "./harness";

/**
 * SUP-2 — the columns a client may supply when opening a ticket or replying.
 *
 * The insert policy pins `user_id` and nothing else, so the defaults that were
 * meant to be the truth were only a fallback for a client polite enough not to
 * mention them. The two that matter both hide a safeguarding report in plain
 * sight: `resolved` at creation misses the admin queue's urgent lift, which
 * filters resolved out, and a `last_message_at` in 2999 sorts off the end of a
 * queue ordered oldest-activity-first.
 */
describe("support insert column pinning", () => {
  let db: Db;
  let reporter: string, ticket: string;

  beforeAll(async () => {
    db = await createTestDb();
    reporter = await createUser(db, "student", "Robin Reporter");
    const t = await db.query<{ id: string }>(
      `insert into public.support_tickets (user_id, subject, category)
       values ($1, 'Existing', 'safeguarding') returning id`,
      [reporter],
    );
    ticket = t.rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  describe("opening a ticket", () => {
    it("refuses a safeguarding report that arrives already resolved", async () => {
      await as(db, user(reporter), async () => {
        await expect(
          db.query(
            `insert into public.support_tickets (user_id, subject, category, status)
             values ($1, 'Pre-resolved', 'safeguarding', 'resolved')`,
            [reporter],
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it("refuses a ticket that assigns itself to an admin", async () => {
      await as(db, user(reporter), async () => {
        await expect(
          db.query(
            `insert into public.support_tickets (user_id, subject, category, assigned_admin_id)
             values ($1, 'Pre-assigned', 'other', $1)`,
            [reporter],
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it("refuses a ticket dated off the end of the queue", async () => {
      await as(db, user(reporter), async () => {
        await expect(
          db.query(
            `insert into public.support_tickets (user_id, subject, category, last_message_at)
             values ($1, 'Far future', 'safeguarding', timestamptz '2999-01-01')`,
            [reporter],
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it("still opens an ordinary ticket, with the defaults standing", async () => {
      // The guard must not cost the thing it guards.
      await as(db, user(reporter), async () => {
        const r = await db.query<{ status: string; assigned_admin_id: string | null }>(
          `insert into public.support_tickets (user_id, subject, category)
           values ($1, 'Normal', 'account')
           returning status, assigned_admin_id`,
          [reporter],
        );
        expect(r.rows[0].status).toBe("open");
        expect(r.rows[0].assigned_admin_id).toBeNull();
      });
    });
  });

  describe("replying", () => {
    it("refuses a message that dates itself", async () => {
      // A thread IS the record of what was said and when.
      await as(db, user(reporter), async () => {
        await expect(
          db.query(
            `insert into public.support_messages (ticket_id, sender_id, from_admin, body, created_at)
             values ($1, $2, false, 'Backdated', timestamptz '2020-01-01')`,
            [ticket, reporter],
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it("still posts an ordinary reply", async () => {
      await as(db, user(reporter), async () => {
        const r = await db.query(
          `insert into public.support_messages (ticket_id, sender_id, from_admin, body)
           values ($1, $2, false, 'A normal reply') returning id`,
          [ticket, reporter],
        );
        expect(r.rows).toHaveLength(1);
      });
    });
  });

  describe("what the service role must keep", () => {
    it("can still set every column, because the admin tooling does", async () => {
      await as(db, serviceRole, async () => {
        const r = await db.query(
          `insert into public.support_tickets (user_id, subject, category, status, last_message_at)
           values ($1, 'Opened by support', 'other', 'in_progress', now()) returning id`,
          [reporter],
        );
        expect(r.rows).toHaveLength(1);
      });
    });
  });
});
