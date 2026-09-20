import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, as, createUser, user, serviceRole, type Db } from "./harness";

/**
 * SUP-3 — support rate limits that hold where the writes actually land.
 *
 * The limits live in the Server Action, which is not the boundary. The anon
 * key is public by design, so anyone with a session can POST straight to
 * PostgREST and never meet them. That is a flood path into the safeguarding
 * queue — the one a human reads, where burying a real report under noise IS
 * the harm.
 *
 * Rows are seeded with plain db.query because as() wraps its block in
 * begin/rollback: anything seeded inside it would not exist for the assertion.
 */
describe("support write rate limits", () => {
  let db: Db;
  let flooder: string, bystander: string, admin: string;

  async function seedTickets(userId: string, count: number, ageHours = 0) {
    for (let i = 0; i < count; i++) {
      await db.query(
        `insert into public.support_tickets (user_id, subject, category, created_at)
         values ($1, $2, 'other', now() - make_interval(hours => $3))`,
        [userId, `Seeded ${i}`, ageHours],
      );
    }
  }

  beforeAll(async () => {
    db = await createTestDb();
    flooder = await createUser(db, "student", "Flo Flooder");
    bystander = await createUser(db, "student", "Bea Bystander");
    admin = await createUser(db, "admin", "Ada Admin");
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  describe("opening tickets", () => {
    it("refuses the sixth ticket in an hour, written directly", async () => {
      await seedTickets(flooder, 5);

      await as(db, user(flooder), async () => {
        await expect(
          db.query(
            `insert into public.support_tickets (user_id, subject, category)
             values ($1, 'Sixth', 'safeguarding')`,
            [flooder],
          ),
        ).rejects.toThrow(/too many support requests/i);
      });

      await db.query(`delete from public.support_tickets where user_id = $1`, [flooder]);
    });

    it("lets the same person back in once the window has passed", async () => {
      // A limit that never lifts is a ban, and this one is aimed at a script,
      // not at a person having a bad week.
      await seedTickets(flooder, 5, 2);

      await as(db, user(flooder), async () => {
        const r = await db.query(
          `insert into public.support_tickets (user_id, subject, category)
           values ($1, 'Later', 'other') returning id`,
          [flooder],
        );
        expect(r.rows).toHaveLength(1);
      });

      await db.query(`delete from public.support_tickets where user_id = $1`, [flooder]);
    });

    it("does not punish anyone else for one account's flood", async () => {
      await seedTickets(flooder, 5);

      await as(db, user(bystander), async () => {
        const r = await db.query(
          `insert into public.support_tickets (user_id, subject, category)
           values ($1, 'Unrelated', 'account') returning id`,
          [bystander],
        );
        expect(r.rows).toHaveLength(1);
      });

      await db.query(`delete from public.support_tickets where user_id = $1`, [flooder]);
    });

    it("leaves the service role alone", async () => {
      // The admin console and the cron sweep write through it. Limiting them
      // would break the tooling that answers the queue this protects.
      await seedTickets(flooder, 8);

      await as(db, serviceRole, async () => {
        const r = await db.query(
          `insert into public.support_tickets (user_id, subject, category)
           values ($1, 'Opened for them', 'other') returning id`,
          [flooder],
        );
        expect(r.rows).toHaveLength(1);
      });

      await db.query(`delete from public.support_tickets where user_id = $1`, [flooder]);
    });
  });

  describe("replying", () => {
    let ticket: string;

    beforeAll(async () => {
      const t = await db.query<{ id: string }>(
        `insert into public.support_tickets (user_id, subject, category)
         values ($1, 'Long thread', 'other') returning id`,
        [flooder],
      );
      ticket = t.rows[0].id;
    });

    async function seedMessages(senderId: string, count: number) {
      for (let i = 0; i < count; i++) {
        await db.query(
          `insert into public.support_messages (ticket_id, sender_id, from_admin, body)
           values ($1, $2, false, $3)`,
          [ticket, senderId, `Seeded reply ${i}`],
        );
      }
    }

    it("refuses the twenty-first reply in an hour, written directly", async () => {
      await seedMessages(flooder, 20);

      await as(db, user(flooder), async () => {
        await expect(
          db.query(
            `insert into public.support_messages (ticket_id, sender_id, from_admin, body)
             values ($1, $2, false, 'and another')`,
            [ticket, flooder],
          ),
        ).rejects.toThrow(/too many replies/i);
      });
    });

    it("still lets an admin answer through the service role", async () => {
      // The flooder's own limit must never become a gag on support.
      await as(db, serviceRole, async () => {
        const r = await db.query(
          `insert into public.support_messages (ticket_id, sender_id, from_admin, body)
           values ($1, $2, true, 'We are looking into this.') returning id`,
          [ticket, admin],
        );
        expect(r.rows).toHaveLength(1);
      });
    });
  });
});
