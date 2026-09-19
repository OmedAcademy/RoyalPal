import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  as,
  createTestDb,
  createTutorProfile,
  createUser,
  runAs,
  serviceRole,
  user,
  type Db,
} from "@/tests/db/harness";

/**
 * Messaging attack surface (migration 0032).
 *
 * Messaging is the feature with the largest abuse surface in the product and
 * the only one where one user's input is delivered verbatim to another. Every
 * test here asserts the SECURE behaviour; a failure is a hole, never a broken
 * test.
 *
 * The threat model, in the order the tests follow it:
 *   M1-M2  an outsider reading or writing someone else's thread
 *   M3-M4  writing in another person's NAME inside a thread you are in
 *   M5     writing into a closed thread
 *   M6-M8  the mark-as-read policy being used to edit or forge
 *   M9     a client manufacturing the relationship itself
 */

const REFUSAL_CODES = ["42501", "P0001"];

async function expectRefused(attempt: Promise<unknown>): Promise<void> {
  let err: { code?: string; message?: string } | undefined;
  try {
    await attempt;
  } catch (e) {
    err = e as { code?: string; message?: string };
  }
  expect(err, "VULNERABLE: the database accepted this write").toBeDefined();
  expect(REFUSAL_CODES, `refused for the wrong reason: ${err?.code} ${err?.message}`).toContain(
    err?.code,
  );
}

let db: Db;
let student: string;
let tutor: string;
let outsider: string;
let conversationId: string;
let closedConversationId: string;
let tutorMessageId: string;

beforeAll(async () => {
  db = await createTestDb();
  student = await createUser(db, "student", "Sam Student");
  tutor = await createUser(db, "tutor", "Tia Tutor");
  outsider = await createUser(db, "student", "Otto Outsider");
  await createTutorProfile(db, tutor, { verification_status: "approved" });

  const subjectId = (
    await db.query<{ id: number }>(
      "insert into public.subjects (name, category, slug) values ('German', 'Language', 'german') returning id",
    )
  ).rows[0].id;

  const makeBooking = async (startAt: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.bookings
           (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes,
            price_cents, platform_fee_cents)
         values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '60 minutes', 60, 5000, 500)
         returning id`,
        [student, tutor, subjectId, startAt],
      )
    ).rows[0].id;

  const openBooking = await makeBooking("2030-04-01 10:00+00");
  const closedBooking = await makeBooking("2030-04-02 10:00+00");

  conversationId = (
    await db.query<{ id: string }>(
      `insert into public.conversations (booking_id, student_id, tutor_id)
       values ($1, $2, $3) returning id`,
      [openBooking, student, tutor],
    )
  ).rows[0].id;

  closedConversationId = (
    await db.query<{ id: string }>(
      `insert into public.conversations (booking_id, student_id, tutor_id, status, closed_reason)
       values ($1, $2, $3, 'closed', 'Lesson finished') returning id`,
      [closedBooking, student, tutor],
    )
  ).rows[0].id;

  tutorMessageId = (
    await db.query<{ id: string }>(
      `insert into public.messages (conversation_id, sender_id, body)
       values ($1, $2, 'See you Tuesday.') returning id`,
      [conversationId, tutor],
    )
  ).rows[0].id;
}, 60_000);

afterAll(async () => {
  await db.close();
});

const sendAs = (actor: string, conversation: string, sender: string, body = "hello") =>
  runAs(
    db,
    user(actor),
    "insert into public.messages (conversation_id, sender_id, body) values ($1, $2, $3) returning id",
    [conversation, sender, body],
  );

describe("M · an outsider and someone else's thread", () => {
  it("M1 cannot read the conversation", async () => {
    const rows = await runAs(
      db,
      user(outsider),
      "select id from public.conversations where id = $1",
      [conversationId],
    );
    // RLS filters rather than refuses on SELECT — invisible, not forbidden.
    expect(rows).toHaveLength(0);
  });

  it("M1b cannot read its messages", async () => {
    const rows = await runAs(
      db,
      user(outsider),
      "select id from public.messages where conversation_id = $1",
      [conversationId],
    );
    expect(rows).toHaveLength(0);
  });

  it("M2 cannot post into it, even naming themselves as sender", async () => {
    await expectRefused(sendAs(outsider, conversationId, outsider));
  });

  it("M2b cannot post into it while impersonating a participant", async () => {
    await expectRefused(sendAs(outsider, conversationId, student));
  });
});

describe("M · a participant", () => {
  it("M3 (control) can post in their own open thread", async () => {
    expect(await sendAs(student, conversationId, student)).toHaveLength(1);
  });

  it("M4 cannot post in the other participant's name", async () => {
    // The student is genuinely in this conversation; the attack is writing a
    // message that will render as the TUTOR's.
    await expectRefused(sendAs(student, conversationId, tutor, "I waive my refund."));
  });

  it("M5 cannot post into a closed thread", async () => {
    await expectRefused(sendAs(student, closedConversationId, student));
  });

  it("M5b cannot reopen a closed thread to get around that", async () => {
    // An UPDATE whose RLS USING clause matches nothing affects zero rows and
    // raises NOTHING — it is silently filtered, not refused. Asserting an
    // exception here would be asserting the wrong mechanism, so this checks
    // the two things that actually matter: no row came back, and the row is
    // still closed when read again inside the same transaction.
    await as(db, user(student), async () => {
      const { rows } = await db.query(
        "update public.conversations set status = 'open' where id = $1 returning id",
        [closedConversationId],
      );
      expect(rows, "a participant reopened a closed conversation").toHaveLength(0);

      const { rows: after } = await db.query<{ status: string }>(
        "select status from public.conversations where id = $1",
        [closedConversationId],
      );
      expect(after[0].status).toBe("closed");
    });
  });
});

describe("M · the mark-as-read policy", () => {
  it("M6 cannot be used to rewrite what the other person said", async () => {
    await expectRefused(
      runAs(
        db,
        user(student),
        "update public.messages set body = 'I agreed to a full refund' where id = $1 returning id",
        [tutorMessageId],
      ),
    );
  });

  it("M6b cannot be used to rewrite a message while also marking it read", async () => {
    // The plausible bypass: a legitimate read_at write with a body change
    // smuggled into the same statement.
    await expectRefused(
      runAs(
        db,
        user(student),
        "update public.messages set body = 'tampered', read_at = now() where id = $1 returning id",
        [tutorMessageId],
      ),
    );
  });

  it("M7 cannot be used to mark your OWN message read", async () => {
    // Forging a read receipt: "you saw my cancellation notice".
    await as(db, user(tutor), async () => {
      const { rows } = await db.query(
        "update public.messages set read_at = now() where id = $1 returning id",
        [tutorMessageId],
      );
      expect(rows, "a sender marked their own message as read").toHaveLength(0);
    });
  });

  it("M8 (control) lets the recipient mark it read", async () => {
    await as(db, user(student), async () => {
      const { rows } = await db.query(
        "update public.messages set read_at = now() where id = $1 returning id",
        [tutorMessageId],
      );
      expect(rows).toHaveLength(1);
    });
  });
});

describe("M · manufacturing the relationship", () => {
  it("M9 a client cannot create a conversation at all", async () => {
    const booking = (await db.query<{ id: string }>("select id from public.bookings limit 1"))
      .rows[0].id;
    await expectRefused(
      runAs(
        db,
        user(outsider),
        `insert into public.conversations (booking_id, student_id, tutor_id)
         values (gen_random_uuid(), $1, $2) returning id`,
        [outsider, tutor],
      ),
    );
    // Nor by pointing at a real booking they are not part of.
    await expectRefused(
      runAs(
        db,
        user(outsider),
        `insert into public.conversations (booking_id, student_id, tutor_id)
         values ($1, $2, $3) returning id`,
        [booking, outsider, tutor],
      ),
    );
  });

  it("M9b (control) the service role can, which is how createBooking opens one", async () => {
    const subjectId = (await db.query<{ id: number }>("select id from public.subjects limit 1"))
      .rows[0].id;
    await as(db, serviceRole, async () => {
      const { rows: booking } = await db.query<{ id: string }>(
        `insert into public.bookings
           (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes,
            price_cents, platform_fee_cents)
         values ($1, $2, $3, '2030-08-01 10:00+00', '2030-08-01 11:00+00', 60, 5000, 500)
         returning id`,
        [student, tutor, subjectId],
      );
      const { rows } = await db.query(
        `insert into public.conversations (booking_id, student_id, tutor_id)
         values ($1, $2, $3) returning id`,
        [booking[0].id, student, tutor],
      );
      expect(rows).toHaveLength(1);
    });
  });
});
