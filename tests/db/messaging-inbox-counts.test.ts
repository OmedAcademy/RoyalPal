import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, as, createUser, createTutorProfile, user, type Db } from "./harness";

/**
 * MSG-3 and MSG-4 — the two numbers on the inbox.
 *
 * The preview was computed by asking for every listed thread's messages in one
 * capped, oldest-first query. Past the cap it failed from the wrong end: the
 * threads with the most recent activity showed NO preview while quiet old ones
 * showed months-old text.
 *
 * The unread badge had no participant predicate and leaned on RLS. For a
 * student or tutor that is right by accident. For an admin, whose select
 * policy is every message on the platform, the badge counted every unread
 * message between every other pair of people.
 */
describe("inbox preview and unread count", () => {
  let db: Db;
  let tutor: string, student: string, other: string, admin: string;
  let mine: string, theirs: string;

  /** `dayOffset` staggers the lesson: one tutor cannot be in two places at
   * once, and bookings_no_double_booking says so. */
  async function seedThread(studentId: string, dayOffset: number): Promise<string> {
    const b = await db.query<{ id: string }>(
      `insert into public.bookings (student_id,tutor_id,subject_id,start_at,end_at,
         lesson_duration_minutes,price_cents,platform_fee_cents,currency,status)
       values ($1,$2,1,
               now() + make_interval(days => $3),
               now() + make_interval(days => $3) + interval '1 hour',
               60,5000,500,'usd','confirmed')
       returning id`,
      [studentId, tutor, dayOffset],
    );
    const c = await db.query<{ id: string }>(
      `insert into public.conversations (booking_id,student_id,tutor_id) values ($1,$2,$3)
       returning id`,
      [b.rows[0].id, studentId, tutor],
    );
    return c.rows[0].id;
  }

  beforeAll(async () => {
    db = await createTestDb();
    tutor = await createUser(db, "tutor", "Tara Tutor");
    student = await createUser(db, "student", "Sam Student");
    other = await createUser(db, "student", "Otto Other");
    admin = await createUser(db, "admin", "Ada Admin");
    await createTutorProfile(db, tutor, { verification_status: "approved" });
    await db.query(
      `insert into public.subjects (id,name,slug,category) values (1,'English','english','lang')
       on conflict do nothing`,
    );

    mine = await seedThread(student, 2);
    theirs = await seedThread(other, 4);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  describe("the preview (MSG-3)", () => {
    it("is the newest message, not whichever one a cap happened to reach", async () => {
      for (const body of ["first", "second", "the newest thing said"]) {
        await db.query(
          `insert into public.messages (conversation_id,sender_id,body) values ($1,$2,$3)`,
          [mine, tutor, body],
        );
      }

      const r = await db.query<{ last_message_preview: string }>(
        `select last_message_preview from public.conversations where id = $1`,
        [mine],
      );
      expect(r.rows[0].last_message_preview).toBe("the newest thing said");
    });

    it("stays correct on a thread long enough to have blown the old cap", async () => {
      // The old query capped at 1000 rows across every listed thread, so the
      // busiest threads were the ones it ran out of room for.
      for (let i = 0; i < 1200; i++) {
        await db.query(
          `insert into public.messages (conversation_id,sender_id,body) values ($1,$2,$3)`,
          [theirs, tutor, `bulk ${i}`],
        );
      }

      const r = await db.query<{ last_message_preview: string }>(
        `select last_message_preview from public.conversations where id = $1`,
        [theirs],
      );
      expect(r.rows[0].last_message_preview).toBe("bulk 1199");
    });

    it("is truncated, so the column stays a display affordance", async () => {
      await db.query(
        `insert into public.messages (conversation_id,sender_id,body) values ($1,$2,$3)`,
        [mine, tutor, "x".repeat(400)],
      );

      const r = await db.query<{ len: number }>(
        `select length(last_message_preview) as len from public.conversations where id = $1`,
        [mine],
      );
      expect(r.rows[0].len).toBe(140);
    });

    it("is not a column a person can write", async () => {
      // An admin rewriting it would make the inbox say something that never
      // happened, and the thread is the record.
      await as(db, user(admin), async () => {
        await expect(
          db.query(`update public.conversations set last_message_preview = 'fabricated'`),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it("still lets an admin close a thread", async () => {
      await as(db, user(admin), async () => {
        const r = await db.query(
          `update public.conversations set status = 'closed', closed_reason = 'Reported'
           where id = $1 returning id`,
          [mine],
        );
        expect(r.rows).toHaveLength(1);
      });
    });
  });

  describe("the unread badge (MSG-4)", () => {
    it("counts what was sent TO the caller", async () => {
      await as(db, user(student), async () => {
        const r = await db.query<{ unread_message_count: number }>(
          `select public.unread_message_count()`,
        );
        // Everything in `mine` was sent by the tutor and never read.
        expect(r.rows[0].unread_message_count).toBeGreaterThan(0);
      });
    });

    it("does not count a conversation the caller is not in", async () => {
      // `theirs` holds 1200 unread messages between two other people.
      await as(db, user(student), async () => {
        const r = await db.query<{ unread_message_count: number }>(
          `select public.unread_message_count()`,
        );
        expect(r.rows[0].unread_message_count).toBeLessThan(100);
      });
    });

    it("does not hand an admin the whole platform's unread count", async () => {
      // The admin's select policy on messages IS every message. That is what
      // made the badge in their navigation count other people's conversations.
      await as(db, user(admin), async () => {
        const r = await db.query<{ unread_message_count: number }>(
          `select public.unread_message_count()`,
        );
        expect(r.rows[0].unread_message_count).toBe(0);
      });
    });

    it("does not count the caller's own messages", async () => {
      await as(db, user(tutor), async () => {
        const before = await db.query<{ unread_message_count: number }>(
          `select public.unread_message_count()`,
        );
        expect(before.rows[0].unread_message_count).toBe(0);
      });
    });
  });
});
