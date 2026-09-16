import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  createTutorProfile,
  createUser,
  runAs,
  serviceRole,
  user,
  type Db,
} from "@/tests/db/harness";

/**
 * Booking integrity — the attacks not already pinned elsewhere.
 *
 * Already covered, not repeated here:
 *   insert already 'completed', no payment ... phase2 C2, booking-insert-status
 *   insert already 'confirmed', no payment ... phase2 C1, booking-insert-status
 *   price changed after payment ............. phase2 A1 (student), B1 (tutor)
 *   start time changed after payment ........ phase2 A3 (student), B3 (tutor)
 *
 * New here:
 *   R1     a review on a completed lesson that was never paid for
 *   S1–S3  defence in depth: the SERVICE ROLE — which createBooking inserts
 *          through — writing a completed, confirmed or mispriced row. RLS does
 *          not apply to it, so only a trigger can catch a bug on that path.
 *   R2, S4 controls: the legitimate paths must keep working.
 *
 * Tests assert the secure behaviour; while a hole is open they fail.
 */

/** A security rule said no: grants/RLS/42501 triggers, or a plain RAISE. */
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
let subjectId: number;
let unpaidCompleted: string;
let paidCompleted: string;

beforeAll(async () => {
  db = await createTestDb();
  student = await createUser(db, "student", "Sam Student");
  tutor = await createUser(db, "tutor", "Tia Tutor");
  await createTutorProfile(db, tutor, { verification_status: "approved" });
  subjectId = (
    await db.query<{ id: number }>(
      "insert into public.subjects (name, category, slug) values ('Spanish', 'Language', 'spanish') returning id",
    )
  ).rows[0].id;

  // Both completed by a trusted writer; only one was ever paid for. The unpaid
  // one stands in for any route to 'completed' that skips payment — an admin
  // action, or a bug.
  const completedLesson = async (startAt: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.bookings
           (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes,
            status, price_cents, platform_fee_cents)
         values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '60 minutes', 60,
                 'completed', 5000, 500)
         returning id`,
        [student, tutor, subjectId, startAt],
      )
    ).rows[0].id;
  unpaidCompleted = await completedLesson("2026-01-05 10:00+00");
  paidCompleted = await completedLesson("2026-01-12 10:00+00");
  await db.query(
    `insert into public.payments (booking_id, stripe_payment_intent_id, amount_cents, status, paid_at)
     values ($1, 'pi_paid', 5000, 'succeeded', now())`,
    [paidCompleted],
  );
}, 60_000);

afterAll(async () => {
  await db.close();
});

const REVIEW =
  "insert into public.reviews (booking_id, student_id, tutor_id, rating) values ($1, $2, $3, 5) returning id";

describe("reviews", () => {
  it("R1 a student cannot review a completed lesson that has no successful payment", async () => {
    await expectRefused(runAs(db, user(student), REVIEW, [unpaidCompleted, student, tutor]));
  });

  it("R2 (control) a student can still review a completed, paid lesson", async () => {
    expect(await runAs(db, user(student), REVIEW, [paidCompleted, student, tutor])).toHaveLength(1);
  });
});

const SERVICE_INSERT = `
  insert into public.bookings
    (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes,
     status, price_cents, platform_fee_cents)
  values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '60 minutes', 60, $5, $6, $7)
  returning id`;

const serviceInsert = (startAt: string, status: string, priceCents: number) =>
  runAs(db, serviceRole, SERVICE_INSERT, [
    student,
    tutor,
    subjectId,
    startAt,
    status,
    priceCents,
    Math.floor(priceCents / 10),
  ]);

describe("defence in depth: the service role's own booking inserts", () => {
  it("S1 cannot insert a booking already completed", async () => {
    await expectRefused(serviceInsert("2030-07-01 10:00+00", "completed", 5000));
  });

  it("S2 cannot insert a booking already confirmed", async () => {
    await expectRefused(serviceInsert("2030-07-02 10:00+00", "confirmed", 5000));
  });

  it("S3 cannot insert a booking priced differently from the tutor's rate", async () => {
    // The tutor's hourly rate is 5000; a 60-minute lesson priced at 50.
    await expectRefused(serviceInsert("2030-07-03 10:00+00", "pending_payment", 50));
  });

  it("S4 (control) can still insert a pending booking at the tutor's rate — createBooking's path", async () => {
    expect(await serviceInsert("2030-07-04 10:00+00", "pending_payment", 5000)).toHaveLength(1);
  });
});
