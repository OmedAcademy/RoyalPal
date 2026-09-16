import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  as,
  createTestDb,
  createTutorProfile,
  createUser,
  runAs,
  user,
  type Db,
} from "@/tests/db/harness";

/**
 * Phase 2 booking and payment attack surface — one test per attack in the
 * Phase 2 inspection report, named with the same IDs so the report and the
 * suite line up:
 *   A = student, on their own confirmed and paid booking
 *   B = tutor, on a paid booking they teach
 *   C = at booking time (direct inserts, pre-payment edits)
 *   D = payments table
 *
 * Every attack runs as a signed-in client (PostgREST's `authenticated` role
 * plus that user's JWT claims) against real Postgres with every migration
 * applied, inside a transaction that is always rolled back.
 *
 * THESE TESTS ASSERT THE SECURE BEHAVIOUR. Where a hole is still open the test
 * FAILS — that failure is the documentation, not a broken test. Never invert
 * or skip one to go green; fix the hole it names.
 *
 * STATUS AFTER MIGRATION 0029 (with createBooking inserting via the service role):
 *   Closed by 0029 .......... A1-A5 A7 B1-B4 B7 B8 C1-C10
 *     H1 price/fee, H2 insert status, H3 post-payment edits, H6 role check and
 *     H7 insert checks: clients can no longer INSERT, and every column except
 *     status and cancellation_reason is locked after insert.
 *   STILL EXPECTED TO FAIL (2):
 *     H5  paid lesson cancelled with no refund ..... A9 B6
 *
 * Refused before 0029 and still refused, pinned so they stay refused:
 *   A6 B5  now by the 0029 column-lock trigger, ahead of RLS WITH CHECK (42501)
 *   A8 B9  booking status transition trigger (P0001)
 *   D1 D2  no client write grant on payments (42501)
 *
 * What "refused" encodes, and where that is a decision rather than a fact:
 *   - A9/B6 assume a participant cannot simply set a PAID lesson to
 *     cancelled. The refund policy (H5) is not decided; revisit these when it
 *     is.
 *   - C9 is refused because clients cannot insert at all. createBooking itself
 *     does not stop a student holding two lessons at once; that is still a
 *     product decision (H8).
 *   - C7 proves only that a direct insert is refused. The availability check
 *     itself lives in createBooking and is tested in lib/actions/booking.test.ts.
 */

/**
 * SQLSTATEs that mean a security rule said no: insufficient privilege
 * (grants, RLS WITH CHECK, and this project's 42501 triggers) and a plain
 * RAISE EXCEPTION (P0001, which the 0003 and 0006 triggers use). Constraint,
 * foreign-key and data errors are deliberately NOT accepted, so a test cannot
 * go green because its attack statement stopped being valid.
 */
const REFUSAL_CODES = ["42501", "P0001"];

type PgError = { code?: string; message?: string };

async function capture(attempt: Promise<unknown>): Promise<PgError | undefined> {
  try {
    await attempt;
    return undefined;
  } catch (err) {
    return err as PgError;
  }
}

async function expectRefused(attempt: Promise<unknown>): Promise<void> {
  const err = await capture(attempt);
  expect(err, "VULNERABLE: the database accepted this write").toBeDefined();
  expect(REFUSAL_CODES, `refused for the wrong reason: ${err?.code} ${err?.message}`).toContain(
    err?.code,
  );
}

async function expectRefusedWith(
  attempt: Promise<unknown>,
  code: string,
  message: RegExp,
): Promise<void> {
  const err = await capture(attempt);
  expect(err, "expected a refusal, but the write succeeded").toBeDefined();
  expect(err).toMatchObject({ code });
  expect(err?.message).toMatch(message);
}

let db: Db;
let student: string;
let otherStudent: string;
let tutor: string;
let otherTutor: string;
let unapprovedTutor: string;
let taughtSubject: number;
let untaughtSubject: number;
let paidBooking: string;
let pendingBooking: string;

beforeAll(async () => {
  db = await createTestDb();
  student = await createUser(db, "student", "Sam Student");
  otherStudent = await createUser(db, "student", "Olu Other");
  tutor = await createUser(db, "tutor", "Tia Tutor");
  otherTutor = await createUser(db, "tutor", "Theo Tutor");
  unapprovedTutor = await createUser(db, "tutor", "Una Unapproved");

  await createTutorProfile(db, tutor, {
    verification_status: "approved",
    stripe_account_id: "acct_tutor",
    stripe_charges_enabled: true,
  });
  await createTutorProfile(db, otherTutor, {
    verification_status: "approved",
    stripe_account_id: "acct_other_tutor",
    stripe_charges_enabled: true,
  });
  await createTutorProfile(db, unapprovedTutor);

  const subjectId = async (name: string, category: string, slug: string) =>
    (
      await db.query<{ id: number }>(
        "insert into public.subjects (name, category, slug) values ($1, $2, $3) returning id",
        [name, category, slug],
      )
    ).rows[0].id;
  taughtSubject = await subjectId("Spanish", "Language", "spanish");
  untaughtSubject = await subjectId("Calculus", "Math", "calculus");
  await db.query("insert into public.tutor_subjects (tutor_id, subject_id) values ($1, $2)", [
    tutor,
    taughtSubject,
  ]);

  // Confirmed AND paid: the state every A and B attack targets.
  paidBooking = (
    await db.query<{ id: string }>(
      `insert into public.bookings
         (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes, status,
          price_cents, platform_fee_cents, meeting_provider, meeting_url, meeting_status)
       values ($1, $2, $3, '2030-05-06 10:00+00', '2030-05-06 11:00+00', 60, 'confirmed',
               5000, 500, 'google_meet', 'https://meet.google.com/abc-defg-hij', 'scheduled')
       returning id`,
      [student, tutor, taughtSubject],
    )
  ).rows[0].id;
  await db.query(
    `insert into public.payments (booking_id, stripe_payment_intent_id, amount_cents, status, paid_at)
     values ($1, 'pi_paid', 5000, 'succeeded', now())`,
    [paidBooking],
  );

  pendingBooking = (
    await db.query<{ id: string }>(
      `insert into public.bookings
         (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes,
          price_cents, platform_fee_cents)
       values ($1, $2, $3, '2030-05-07 10:00+00', '2030-05-07 11:00+00', 60, 5000, 500)
       returning id`,
      [student, tutor, taughtSubject],
    )
  ).rows[0].id;
}, 60_000);

afterAll(async () => {
  await db.close();
});

const INSERT_BOOKING = `
  insert into public.bookings
    (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes,
     status, price_cents, platform_fee_cents)
  values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '60 minutes', 60, $5, $6, $7)
  returning id`;

type BookingInsert = {
  studentId: string;
  tutorId: string;
  subjectId: number;
  startAt: string;
  status?: string;
  priceCents?: number;
  feeCents?: number;
};

/** An otherwise-valid booking insert, for use inside an `as()` transaction. */
const bookingInsert = (b: BookingInsert) =>
  db.query<{ id: string }>(INSERT_BOOKING, [
    b.studentId,
    b.tutorId,
    b.subjectId,
    b.startAt,
    b.status ?? "pending_payment",
    b.priceCents ?? 5000,
    b.feeCents ?? 500,
  ]);

const insertBookingAs = (actorId: string, b: BookingInsert) =>
  as(db, user(actorId), () => bookingInsert(b));

/**
 * Updates one booking as `actorId`. Throws NO_ROW if RLS hid the row: that is
 * a fixture problem, not a refusal, and must not satisfy expectRefused.
 */
async function updateBookingAs(
  actorId: string,
  bookingId: string,
  set: string,
  params: unknown[] = [],
): Promise<void> {
  const rows = await runAs(
    db,
    user(actorId),
    `update public.bookings set ${set} where id = $1 returning id`,
    [bookingId, ...params],
  );
  if (rows.length === 0) {
    throw Object.assign(new Error("update matched no visible row"), { code: "NO_ROW" });
  }
}

describe("A · student, on their own confirmed and paid booking", () => {
  it("A1 cannot lower price_cents after payment [H1]", async () => {
    await expectRefused(updateBookingAs(student, paidBooking, "price_cents = 1"));
  });

  it("A2 cannot zero platform_fee_cents after payment [H1]", async () => {
    await expectRefused(updateBookingAs(student, paidBooking, "platform_fee_cents = 0"));
  });

  it("A3 cannot move start_at/end_at after payment [H3]", async () => {
    await expectRefused(
      updateBookingAs(
        student,
        paidBooking,
        "start_at = start_at + interval '7 days', end_at = end_at + interval '7 days'",
      ),
    );
  });

  it("A4 cannot switch tutor_id to another tutor after payment [H3]", async () => {
    await expectRefused(updateBookingAs(student, paidBooking, "tutor_id = $2", [otherTutor]));
  });

  it("A5 cannot switch subject_id after payment [H3]", async () => {
    await expectRefused(
      updateBookingAs(student, paidBooking, "subject_id = $2", [untaughtSubject]),
    );
  });

  it("A6 cannot transfer ownership via student_id (already refused)", async () => {
    // Since 0029 the refusal comes from the column-lock trigger, ahead of RLS WITH CHECK.
    const { err, before, after } = await as(db, user(student), async () => {
      const read = async () =>
        (await db.query("select * from public.bookings where id = $1", [paidBooking])).rows[0];
      const before = await read();
      let err: PgError | undefined;
      await db.exec("savepoint attempt");
      try {
        await db.query("update public.bookings set student_id = $2 where id = $1", [
          paidBooking,
          otherStudent,
        ]);
      } catch (e) {
        err = e as PgError;
        await db.exec("rollback to savepoint attempt");
      }
      // Read in the SAME transaction: a write that got through is visible here.
      return { err, before, after: await read() };
    });
    expect.soft(err, "the write was not refused").toMatchObject({ code: "42501" });
    expect.soft(after, "the row changed").toEqual(before);
  });

  it("A7 cannot swap meeting_url after payment [H3]", async () => {
    await expectRefused(
      updateBookingAs(student, paidBooking, "meeting_url = 'https://attacker.example/phish'"),
    );
  });

  it("A8 cannot mark the lesson completed (already refused by the status trigger)", async () => {
    await expectRefusedWith(
      updateBookingAs(student, paidBooking, "status = 'completed'"),
      "P0001",
      /only an admin or the system can mark a booking completed/,
    );
  });

  it("A9 cannot set a paid lesson to cancelled directly [H5, policy undecided]", async () => {
    await expectRefused(updateBookingAs(student, paidBooking, "status = 'cancelled'"));
  });
});

describe("B · tutor, on a paid booking they teach", () => {
  it("B1 cannot raise price_cents after payment [H1]", async () => {
    await expectRefused(updateBookingAs(tutor, paidBooking, "price_cents = 999999"));
  });

  it("B2 cannot reassign the booking to another student [H3]", async () => {
    await expectRefused(updateBookingAs(tutor, paidBooking, "student_id = $2", [otherStudent]));
  });

  it("B3 cannot move start_at/end_at after payment [H3]", async () => {
    // +3 hours: clear of the tutor's other booking, so only a security rule
    // can refuse it (a 23P01 overlap would not count).
    await expectRefused(
      updateBookingAs(
        tutor,
        paidBooking,
        "start_at = start_at + interval '3 hours', end_at = end_at + interval '3 hours'",
      ),
    );
  });

  it("B4 cannot swap meeting_url after payment [H3]", async () => {
    await expectRefused(
      updateBookingAs(tutor, paidBooking, "meeting_url = 'https://attacker.example/phish'"),
    );
  });

  it("B5 cannot hand the booking to another tutor via tutor_id (already refused)", async () => {
    // Since 0029 the refusal comes from the column-lock trigger, ahead of RLS WITH CHECK.
    const { err, before, after } = await as(db, user(tutor), async () => {
      const read = async () =>
        (await db.query("select * from public.bookings where id = $1", [paidBooking])).rows[0];
      const before = await read();
      let err: PgError | undefined;
      await db.exec("savepoint attempt");
      try {
        await db.query("update public.bookings set tutor_id = $2 where id = $1", [
          paidBooking,
          otherTutor,
        ]);
      } catch (e) {
        err = e as PgError;
        await db.exec("rollback to savepoint attempt");
      }
      // Read in the SAME transaction: a write that got through is visible here.
      return { err, before, after: await read() };
    });
    expect.soft(err, "the write was not refused").toMatchObject({ code: "42501" });
    expect.soft(after, "the row changed").toEqual(before);
  });

  it("B6 cannot set a paid lesson to cancelled directly [H5, policy undecided]", async () => {
    await expectRefused(updateBookingAs(tutor, paidBooking, "status = 'cancelled'"));
  });

  it("B7 cannot book themselves as a completed lesson and review themselves [H2, H6]", async () => {
    await expectRefused(
      as(db, user(tutor), async () => {
        const { rows } = await bookingInsert({
          studentId: tutor,
          tutorId: tutor,
          subjectId: taughtSubject,
          startAt: "2026-01-12 10:00+00",
          status: "completed",
        });
        await db.query(
          "insert into public.reviews (booking_id, student_id, tutor_id, rating) values ($1, $2, $2, 5)",
          [rows[0].id, tutor],
        );
      }),
    );
  });

  it("B8 cannot switch subject_id after payment [H3]", async () => {
    await expectRefused(updateBookingAs(tutor, paidBooking, "subject_id = $2", [untaughtSubject]));
  });

  it("B9 cannot mark the lesson completed (already refused by the status trigger)", async () => {
    await expectRefusedWith(
      updateBookingAs(tutor, paidBooking, "status = 'completed'"),
      "P0001",
      /only an admin or the system can mark a booking completed/,
    );
  });
});

describe("C · at booking time: direct inserts and pre-payment edits", () => {
  it("C1 cannot insert a booking already confirmed, with no payment [H2]", async () => {
    await expectRefused(
      insertBookingAs(student, {
        studentId: student,
        tutorId: tutor,
        subjectId: taughtSubject,
        startAt: "2030-06-03 10:00+00",
        status: "confirmed",
      }),
    );
  });

  it("C2 cannot insert a booking already completed, with no payment [H2]", async () => {
    await expectRefused(
      insertBookingAs(student, {
        studentId: student,
        tutorId: tutor,
        subjectId: taughtSubject,
        startAt: "2026-01-05 10:00+00",
        status: "completed",
      }),
    );
  });

  it("C3 cannot insert a booking with its own price_cents and platform_fee_cents [H1]", async () => {
    await expectRefused(
      insertBookingAs(student, {
        studentId: student,
        tutorId: tutor,
        subjectId: taughtSubject,
        startAt: "2030-06-04 10:00+00",
        priceCents: 50,
        feeCents: 0,
      }),
    );
  });

  it("C4 cannot re-price their own pending booking before paying [H1]", async () => {
    await expectRefused(
      updateBookingAs(student, pendingBooking, "price_cents = 50, platform_fee_cents = 0"),
    );
  });

  it("C5 cannot book an unapproved tutor [H7]", async () => {
    await expectRefused(
      insertBookingAs(student, {
        studentId: student,
        tutorId: unapprovedTutor,
        subjectId: taughtSubject,
        startAt: "2030-06-05 10:00+00",
      }),
    );
  });

  it("C6 cannot book a subject the tutor does not teach [H7]", async () => {
    await expectRefused(
      insertBookingAs(student, {
        studentId: student,
        tutorId: tutor,
        subjectId: untaughtSubject,
        startAt: "2030-06-06 10:00+00",
      }),
    );
  });

  it("C7 cannot book a time outside the tutor's availability [H4]", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.availability_rules where tutor_id = $1",
      [tutor],
    );
    expect(rows[0].n, "precondition: the tutor offers no availability at all").toBe(0);

    await expectRefused(
      insertBookingAs(student, {
        studentId: student,
        tutorId: tutor,
        subjectId: taughtSubject,
        startAt: "2030-06-09 03:00+00",
      }),
    );
  });

  it("C8 cannot book a start time in the past [H7]", async () => {
    await expectRefused(
      insertBookingAs(student, {
        studentId: student,
        tutorId: tutor,
        subjectId: taughtSubject,
        startAt: "2020-01-06 10:00+00",
      }),
    );
  });

  it("C9 cannot hold two tutors at the same moment [H8]", async () => {
    await expectRefused(
      as(db, user(student), async () => {
        const at = "2030-06-10 10:00+00";
        await bookingInsert({
          studentId: student,
          tutorId: tutor,
          subjectId: taughtSubject,
          startAt: at,
        });
        await bookingInsert({
          studentId: student,
          tutorId: otherTutor,
          subjectId: taughtSubject,
          startAt: at,
        });
      }),
    );
  });

  it("C10 a tutor cannot book another tutor as if they were a student [H6]", async () => {
    await expectRefused(
      insertBookingAs(otherTutor, {
        studentId: otherTutor,
        tutorId: tutor,
        subjectId: taughtSubject,
        startAt: "2030-06-11 10:00+00",
      }),
    );
  });
});

describe("D · payments table", () => {
  it("D1 a student cannot edit their own payment (already refused: no grant)", async () => {
    await expectRefusedWith(
      runAs(
        db,
        user(student),
        "update public.payments set amount_cents = 1 where booking_id = $1 returning id",
        [paidBooking],
      ),
      "42501",
      /permission denied for table payments/,
    );
  });

  it("D2 a student cannot insert a succeeded payment (already refused: no grant)", async () => {
    await expectRefusedWith(
      runAs(
        db,
        user(student),
        "insert into public.payments (booking_id, amount_cents, status) values ($1, 5000, 'succeeded') returning id",
        [pendingBooking],
      ),
      "42501",
      /permission denied for table payments/,
    );
  });
});
