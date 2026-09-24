import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createTutorProfile, createUser, type Db } from "@/tests/db/harness";

/**
 * bookings_no_student_overlap (0047).
 *
 * The tutor exclusion stops two students taking one tutor. It does not stop
 * one student booking two tutors for the same hour. That second insert must
 * fail in the database, not only in the form.
 */

let db: Db;
let student: string;
let tutorA: string;
let tutorB: string;
let subjectId: number;

beforeAll(async () => {
  db = await createTestDb();
  student = await createUser(db, "student", "Sam Student");
  tutorA = await createUser(db, "tutor", "Tutor A");
  tutorB = await createUser(db, "tutor", "Tutor B");
  await createTutorProfile(db, tutorA, { verification_status: "approved" });
  await createTutorProfile(db, tutorB, { verification_status: "approved" });
  subjectId = (
    await db.query<{ id: number }>(
      "insert into public.subjects (name, category, slug) values ('French', 'Language', 'french-overlap') returning id",
    )
  ).rows[0].id;
});

afterAll(async () => {
  await db.close();
});

async function insertLive(tutor: string, startAt: string) {
  return db.query(
    `insert into public.bookings
       (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes,
        status, price_cents, platform_fee_cents)
     values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '60 minutes', 60,
             'pending_payment', 5000, 500)`,
    [student, tutor, subjectId, startAt],
  );
}

describe("student overlap", () => {
  it("refuses a second live lesson that overlaps the first, even with a different tutor", async () => {
    await insertLive(tutorA, "2026-06-01 15:00+00");
    await expect(insertLive(tutorB, "2026-06-01 15:30+00")).rejects.toMatchObject({
      code: "23P01",
    });
  });

  it("still allows the same student a later, non-overlapping lesson", async () => {
    await expect(insertLive(tutorB, "2026-06-01 17:00+00")).resolves.toBeDefined();
  });
});
