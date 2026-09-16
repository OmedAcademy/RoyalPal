import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  as,
  createTestDb,
  createTutorProfile,
  createUser,
  user,
  type Db,
} from "@/tests/db/harness";

/**
 * Fixed by migration 0029; kept as regression tests.
 *
 * Before 0029, bookings_insert_own_as_student (0006) checked only student_id,
 * and enforce_booking_status_transition fires BEFORE UPDATE only, so nothing
 * inspected `status` on INSERT; reviews_insert_own_completed_booking (0008)
 * accepted a review for any of the student's bookings that was 'completed'.
 * Together: a student could mint a lesson that never happened, already
 * completed or confirmed, with no payment, and review it — writing the
 * tutor's public rating through recompute_tutor_rating.
 *
 * 0029 removes the client INSERT on bookings and requires a succeeded payment
 * for a review. The assertion is the SECURE behaviour; if the hole reopens,
 * the failure diff shows exactly how far the attack got.
 */

let db: Db;
let student: string;
let tutor: string;
let subjectId: number;

beforeAll(async () => {
  db = await createTestDb();
  student = await createUser(db, "student", "Sam Student");
  tutor = await createUser(db, "tutor", "Tia Tutor");
  await createTutorProfile(db, tutor, { verification_status: "approved" });
  const { rows } = await db.query<{ id: number }>(
    "insert into public.subjects (name, category, slug) values ('Spanish', 'Language', 'spanish') returning id",
  );
  subjectId = rows[0].id;
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("a student cannot fabricate a completed lesson and review it", () => {
  it("refuses a student inserting a booking already marked completed, so no review can follow", async () => {
    const attack = await as(db, user(student), async () => {
      let bookingId: string;
      try {
        const { rows } = await db.query<{ id: string }>(
          `insert into public.bookings
             (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes,
              status, price_cents, platform_fee_cents)
           values ($1, $2, $3, '2026-01-05 10:00+00', '2026-01-05 11:00+00', 60,
                   'completed', 5000, 500)
           returning id`,
          [student, tutor, subjectId],
        );
        bookingId = rows[0].id;
      } catch (err) {
        return {
          completedBookingInserted: false,
          reviewPosted: false,
          refusedWith: (err as { code?: string }).code,
        };
      }

      try {
        await db.query(
          "insert into public.reviews (booking_id, student_id, tutor_id, rating, comment) values ($1, $2, $3, 5, 'Best tutor ever')",
          [bookingId, student, tutor],
        );
      } catch (err) {
        return {
          completedBookingInserted: true,
          reviewPosted: false,
          refusedWith: (err as { code?: string }).code,
        };
      }

      const payments = await db.query<{ n: number }>(
        "select count(*)::int as n from public.payments where booking_id = $1",
        [bookingId],
      );
      const rating = await db.query<{ avg_rating: string | null; total_reviews: number }>(
        "select avg_rating, total_reviews from public.tutor_profiles where id = $1",
        [tutor],
      );
      return {
        completedBookingInserted: true,
        reviewPosted: true,
        paymentsForBooking: payments.rows[0].n,
        tutorRatingAfter: rating.rows[0],
      };
    });

    expect(attack).toEqual({
      completedBookingInserted: false,
      reviewPosted: false,
      refusedWith: expect.any(String),
    });
  });
});

describe("a student cannot fabricate an unpaid confirmed lesson", () => {
  // Same root cause: nothing inspects `status` on INSERT. 'confirmed' is the
  // state 0006's transition matrix reserves for the payment webhook or an
  // admin. It is what BookingCard labels a booked lesson, what the tutor's
  // dashboard lists, and what the exclusion constraint treats as holding the
  // tutor's slot.
  it("refuses a student inserting a booking already marked confirmed, with no payment", async () => {
    const otherStudent = await createUser(db, "student", "Olu Other");

    const attack = await as(db, user(student), async () => {
      const insertAt = (who: string) =>
        db.query<{ id: string }>(
          `insert into public.bookings
             (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes,
              status, price_cents, platform_fee_cents)
           values ($1, $2, $3, '2030-06-03 10:00+00', '2030-06-03 11:00+00', 60,
                   $4, 5000, 500)
           returning id`,
          [who, tutor, subjectId, who === student ? "confirmed" : "pending_payment"],
        );
      const actAs = (id: string) =>
        db.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: id, role: "authenticated" }),
        ]);

      let bookingId: string;
      try {
        bookingId = (await insertAt(student)).rows[0].id;
      } catch (err) {
        return {
          confirmedBookingInserted: false,
          refusedWith: (err as { code?: string }).code,
        };
      }

      const payments = await db.query<{ n: number }>(
        "select count(*)::int as n from public.payments where booking_id = $1",
        [bookingId],
      );

      // The same row as the tutor's own dashboard query would read it.
      await actAs(tutor);
      const seenByTutor = await db.query<{ status: string }>(
        "select status from public.bookings where id = $1",
        [bookingId],
      );

      // A genuine student trying to book that slot. Last, because the
      // expected exclusion violation aborts the transaction.
      await actAs(otherStudent);
      let genuineStudentBlockedFromSlot = false;
      try {
        await insertAt(otherStudent);
      } catch (err) {
        genuineStudentBlockedFromSlot = (err as { code?: string }).code === "23P01";
      }

      return {
        confirmedBookingInserted: true,
        paymentsForBooking: payments.rows[0].n,
        statusSeenByTutor: seenByTutor.rows[0]?.status,
        genuineStudentBlockedFromSlot,
      };
    });

    expect(attack).toEqual({
      confirmedBookingInserted: false,
      refusedWith: expect.any(String),
    });
  });
});
