import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, as, runAs, createUser, createTutorProfile, user, type Db } from "./harness";

/**
 * Suspension, enforced by the database (migration 0042).
 *
 * Before this, suspension lived entirely in application code — middleware,
 * requireProfile, requireApiUser, activeUserOrError. The anon key is public by
 * design and a suspended account keeps a valid JWT, so PostgREST stayed open
 * to it and every one of those checks could simply be walked around.
 *
 * The case that matters is the first one: suspension is how you stop somebody
 * harassing another user, and it did not.
 */
describe("suspension enforcement", () => {
  let db: Db;
  let tutor: string, suspended: string, active: string, admin: string;
  let conversation: string, booking: string, ticket: string;

  beforeAll(async () => {
    db = await createTestDb();
    tutor = await createUser(db, "tutor", "Tara Tutor");
    suspended = await createUser(db, "student", "Suspended Sam");
    active = await createUser(db, "student", "Active Ana");
    admin = await createUser(db, "admin", "Ada Admin");
    await createTutorProfile(db, tutor, { verification_status: "approved" });
    await db.query(
      `insert into public.subjects (id,name,slug,category) values (1,'English','english','lang') on conflict do nothing`,
    );

    for (const student of [suspended, active]) {
      const b = await db.query<{ id: string }>(
        `insert into public.bookings (student_id,tutor_id,subject_id,start_at,end_at,
           lesson_duration_minutes,price_cents,platform_fee_cents,currency,status)
         values ($1,$2,1, now()+interval '2 days', now()+interval '2 days 1 hour',60,5000,500,'usd','completed')
         returning id`,
        [student, tutor],
      );
      await db.query(
        `insert into public.payments (booking_id,amount_cents,currency,status) values ($1,5000,'usd','succeeded')`,
        [b.rows[0].id],
      );
      const c = await db.query<{ id: string }>(
        `insert into public.conversations (booking_id,student_id,tutor_id) values ($1,$2,$3) returning id`,
        [b.rows[0].id, student, tutor],
      );
      if (student === suspended) {
        booking = b.rows[0].id;
        conversation = c.rows[0].id;
      }
    }
    const t = await db.query<{ id: string }>(
      `insert into public.support_tickets (user_id,subject,category) values ($1,'Appeal','other') returning id`,
      [suspended],
    );
    ticket = t.rows[0].id;

    await db.query(`update public.profiles set status='suspended' where id=$1`, [suspended]);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  describe("a suspended account cannot act", () => {
    it("cannot send a message — the harassment case", async () => {
      await as(db, user(suspended), async () => {
        await expect(
          db.query(
            `insert into public.messages (conversation_id,sender_id,body) values ($1,$2,'still here')`,
            [conversation, suspended],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("cannot leave a review", async () => {
      await as(db, user(suspended), async () => {
        await expect(
          db.query(
            `insert into public.reviews (booking_id,student_id,tutor_id,rating,comment) values ($1,$2,$3,1,'bad')`,
            [booking, suspended, tutor],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("cannot add a saved tutor", async () => {
      await as(db, user(suspended), async () => {
        await expect(
          db.query(`insert into public.favorites (student_id,tutor_id) values ($1,$2)`, [
            suspended,
            tutor,
          ]),
        ).rejects.toThrow(/row-level security/i);
      });
    });
  });

  describe("a suspended account keeps what it must", () => {
    it("CAN still open a support ticket — the appeal route", async () => {
      // Deliberate. Middleware allows /support for suspended accounts for this
      // reason; blocking it would leave someone with our own error messages
      // pointing them at a system that refuses them.
      await as(db, user(suspended), async () => {
        const r = await db.query(
          `insert into public.support_tickets (user_id,subject,category) values ($1,'Appeal 2','other') returning id`,
          [suspended],
        );
        expect(r.rows).toHaveLength(1);
      });
    });

    it("CAN still reply on their own ticket", async () => {
      await as(db, user(suspended), async () => {
        const r = await db.query(
          `insert into public.support_messages (ticket_id,sender_id,from_admin,body) values ($1,$2,false,'please review') returning id`,
          [ticket, suspended],
        );
        expect(r.rows).toHaveLength(1);
      });
    });

    it("CAN still read their own bookings", async () => {
      const rows = await runAs(
        db,
        user(suspended),
        `select id from public.bookings where student_id=$1`,
        [suspended],
      );
      expect(rows).toHaveLength(1);
    });

    it("CAN still remove a saved tutor", async () => {
      // USING keeps the delete open; only WITH CHECK gained is_active().
      // Seeded with a direct query, not runAs: the harness rolls back every
      // runAs/as block, so a row seeded that way never survives to be deleted.
      await db.query(
        `insert into public.favorites (student_id,tutor_id) values ($1,$2) on conflict do nothing`,
        [suspended, tutor],
      );
      await as(db, user(suspended), async () => {
        const r = await db.query(
          `delete from public.favorites where student_id=$1 returning student_id`,
          [suspended],
        );
        expect(r.rows).toHaveLength(1);
      });
    });
  });

  describe("an ACTIVE account is unaffected", () => {
    it("can still send a message", async () => {
      const c = (
        await db.query<{ id: string }>(`select id from public.conversations where student_id=$1`, [
          active,
        ])
      ).rows;
      await as(db, user(active), async () => {
        const r = await db.query(
          `insert into public.messages (conversation_id,sender_id,body) values ($1,$2,'hello') returning id`,
          [c[0].id, active],
        );
        expect(r.rows).toHaveLength(1);
      });
    });

    it("can still leave a review", async () => {
      const b = (
        await db.query<{ id: string }>(`select id from public.bookings where student_id=$1`, [
          active,
        ])
      ).rows;
      await as(db, user(active), async () => {
        const r = await db.query(
          `insert into public.reviews (booking_id,student_id,tutor_id,rating,comment) values ($1,$2,$3,5,'great') returning id`,
          [b[0].id, active, tutor],
        );
        expect(r.rows).toHaveLength(1);
      });
    });

    it("can still save a tutor", async () => {
      await as(db, user(active), async () => {
        const r = await db.query(
          `insert into public.favorites (student_id,tutor_id) values ($1,$2) returning student_id`,
          [active, tutor],
        );
        expect(r.rows).toHaveLength(1);
      });
    });
  });

  describe("support_messages.from_admin is pinned to what the database knows", () => {
    it("refuses a non-admin claiming from_admin = true", async () => {
      // The impersonation: a message rendered as "RoyalPal Support" to the
      // user AND to the admin reviewing the thread, inside a record the schema
      // calls evidence.
      const t = (
        await db.query<{ id: string }>(
          `insert into public.support_tickets (user_id,subject,category) values ($1,'x','other') returning id`,
          [active],
        )
      ).rows;
      await as(db, user(active), async () => {
        await expect(
          db.query(
            `insert into public.support_messages (ticket_id,sender_id,from_admin,body) values ($1,$2,true,'RoyalPal Support: confirm your card')`,
            [t[0].id, active],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("still lets a non-admin post a normal message", async () => {
      const t = (
        await db.query<{ id: string }>(
          `insert into public.support_tickets (user_id,subject,category) values ($1,'y','other') returning id`,
          [active],
        )
      ).rows;
      await as(db, user(active), async () => {
        const r = await db.query(
          `insert into public.support_messages (ticket_id,sender_id,from_admin,body) values ($1,$2,false,'hello') returning id`,
          [t[0].id, active],
        );
        expect(r.rows).toHaveLength(1);
      });
    });

    it("still lets an ADMIN post as support — adminReplyToTicket must not break", async () => {
      const t = (
        await db.query<{ id: string }>(
          `insert into public.support_tickets (user_id,subject,category) values ($1,'z','other') returning id`,
          [active],
        )
      ).rows;
      await as(db, user(admin), async () => {
        const r = await db.query(
          `insert into public.support_messages (ticket_id,sender_id,from_admin,body) values ($1,$2,true,'We are looking into it') returning id`,
          [t[0].id, admin],
        );
        expect(r.rows).toHaveLength(1);
      });
    });

    it("refuses an admin posting with from_admin = false", async () => {
      // The pin is an equality, so it holds in both directions.
      const t = (
        await db.query<{ id: string }>(
          `insert into public.support_tickets (user_id,subject,category) values ($1,'w','other') returning id`,
          [active],
        )
      ).rows;
      await as(db, user(admin), async () => {
        await expect(
          db.query(
            `insert into public.support_messages (ticket_id,sender_id,from_admin,body) values ($1,$2,false,'sneaky') returning id`,
            [t[0].id, admin],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });
  });
});
