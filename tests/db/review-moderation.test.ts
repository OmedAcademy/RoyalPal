import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  as,
  createTestDb,
  createTutorProfile,
  createUser,
  runAs,
  postgres,
  user,
  type Db,
} from "@/tests/db/harness";

/**
 * Review moderation and tutor replies (migration 0035).
 *
 * 0008 made reviews immutable, which was right and also meant unmoderatable.
 * 0035 opens exactly two narrow mutations. These tests pin that they stayed
 * narrow — the risk with "reviews can now be updated" is that it quietly
 * becomes "reviews can now be edited".
 */

const REFUSAL_CODES = ["42501", "P0001"];

/**
 * Asserts a write had NO EFFECT, without caring which mechanism stopped it.
 *
 * Postgres refuses a forbidden write two different ways: a trigger raises, so
 * you get an exception, while an RLS USING clause that matches nothing simply
 * updates zero rows and raises nothing at all. Both are secure; which one you
 * get depends on the order the rules happen to be evaluated in, and asserting
 * on that couples the test to an implementation detail rather than to the
 * security property.
 *
 * So this accepts either, and then proves the point that actually matters by
 * reading the row back inside the same transaction.
 */
async function expectNoEffect(
  actor: Parameters<typeof runAs>[1],
  sql: string,
  params: unknown[],
  check: { reviewId: string; column: string; expected: unknown },
): Promise<void> {
  await as(db, actor, async () => {
    let raised = false;
    let affected = 0;
    // A SAVEPOINT, because a raising trigger aborts the transaction and every
    // later statement — including the read-back below — fails with "current
    // transaction is aborted" instead of answering. Rolling back to the
    // savepoint restores a usable transaction without undoing the fixture.
    await db.exec("savepoint attempt");
    try {
      const { rows } = await db.query(sql, params);
      affected = rows.length;
      await db.exec("release savepoint attempt");
    } catch {
      raised = true;
      await db.exec("rollback to savepoint attempt");
    }

    expect(raised || affected === 0, "VULNERABLE: the database accepted this write").toBe(true);

    const { rows: after } = await db.query<Record<string, unknown>>(
      `select ${check.column} from public.reviews where id = $1`,
      [check.reviewId],
    );
    expect(after[0]?.[check.column], `the ${check.column} changed`).toEqual(check.expected);
  });
}

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
let otherStudent: string;
let tutor: string;
let admin: string;
let reviewId: string;
let secondReviewId: string;

beforeAll(async () => {
  db = await createTestDb();
  student = await createUser(db, "student", "Sam Student");
  otherStudent = await createUser(db, "student", "Olu Other");
  tutor = await createUser(db, "tutor", "Tia Tutor");
  admin = await createUser(db, "admin", "Ada Admin");
  await createTutorProfile(db, tutor, { verification_status: "approved" });

  const subjectId = (
    await db.query<{ id: number }>(
      "insert into public.subjects (name, category, slug) values ('Italian', 'Language', 'italian') returning id",
    )
  ).rows[0].id;

  const makeReviewedLesson = async (startAt: string, rating: number) => {
    const booking = (
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
    await db.query(
      `insert into public.payments (booking_id, stripe_payment_intent_id, amount_cents, status, paid_at)
       values ($1, $2, 5000, 'succeeded', now())`,
      [booking, `pi_${booking.slice(0, 8)}`],
    );
    return (
      await db.query<{ id: string }>(
        `insert into public.reviews (booking_id, student_id, tutor_id, rating, comment)
         values ($1, $2, $3, $4, 'Great lesson') returning id`,
        [booking, student, tutor, rating],
      )
    ).rows[0].id;
  };

  reviewId = await makeReviewedLesson("2026-01-05 10:00+00", 5);
  secondReviewId = await makeReviewedLesson("2026-01-12 10:00+00", 1);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("a review's content is immutable — for everyone", () => {
  it("the author cannot edit their own rating or comment", async () => {
    await expectNoEffect(
      user(student),
      "update public.reviews set rating = 1 where id = $1 returning id",
      [reviewId],
      { reviewId, column: "rating", expected: 5 },
    );
    await expectNoEffect(
      user(student),
      "update public.reviews set comment = 'actually terrible' where id = $1 returning id",
      [reviewId],
      { reviewId, column: "comment", expected: "Great lesson" },
    );
  });

  it("the tutor cannot edit the review about them", async () => {
    await expectRefused(
      runAs(db, user(tutor), "update public.reviews set rating = 5 where id = $1 returning id", [
        secondReviewId,
      ]),
    );
  });

  it("not even an admin can rewrite one — moderation hides, it does not edit", async () => {
    await expectRefused(
      runAs(
        db,
        user(admin),
        "update public.reviews set comment = 'redacted' where id = $1 returning id",
        [secondReviewId],
      ),
    );
  });

  it("an outsider cannot touch it at all", async () => {
    await as(db, user(otherStudent), async () => {
      const { rows } = await db.query(
        "update public.reviews set tutor_reply = 'not mine' where id = $1 returning id",
        [reviewId],
      );
      expect(rows, "a stranger replied to someone else's review").toHaveLength(0);
    });
  });
});

describe("the tutor's right of reply", () => {
  it("(control) the tutor can reply once", async () => {
    await as(db, user(tutor), async () => {
      const { rows } = await db.query(
        "update public.reviews set tutor_reply = 'Thank you!', tutor_replied_at = now() where id = $1 returning id",
        [reviewId],
      );
      expect(rows).toHaveLength(1);
    });
  });

  it("cannot reply twice", async () => {
    // Committed outside a rollback so the second attempt sees the first.
    await db.query("update public.reviews set tutor_reply = 'First reply' where id = $1", [
      secondReviewId,
    ]);
    await expectRefused(
      runAs(
        db,
        user(tutor),
        "update public.reviews set tutor_reply = 'Second thoughts' where id = $1 returning id",
        [secondReviewId],
      ),
    );
    await db.query("update public.reviews set tutor_reply = null where id = $1", [secondReviewId]);
  });

  it("cannot smuggle a rating change into a reply", async () => {
    await expectRefused(
      runAs(
        db,
        user(tutor),
        "update public.reviews set tutor_reply = 'Thanks', rating = 5 where id = $1 returning id",
        [secondReviewId],
      ),
    );
  });

  it("cannot hide a review about themselves", async () => {
    // The column lock raises here (only the reply fields are writable by a
    // tutor); the policy would also have filtered it. Either is fine — what
    // matters is that the review is still visible afterwards.
    await expectNoEffect(
      user(tutor),
      "update public.reviews set hidden_at = now(), hidden_by = $2, hidden_reason = 'unfair' where id = $1 returning id",
      [secondReviewId, tutor],
      { reviewId: secondReviewId, column: "hidden_at", expected: null },
    );
  });
});

describe("hiding", () => {
  it("requires who and why, together", async () => {
    // 0035's CHECK: all three columns set, or all three null.
    await expectRefusedByConstraint(
      db.query("update public.reviews set hidden_at = now() where id = $1", [secondReviewId]),
    );
  });

  it("removes the review from the tutor's average, not just from the page", async () => {
    const ratingNow = async () =>
      (
        await db.query<{ avg_rating: string | null; total_reviews: number }>(
          "select avg_rating, total_reviews from public.tutor_profiles where id = $1",
          [tutor],
        )
      ).rows[0];

    const before = await ratingNow();
    expect(before.total_reviews).toBe(2);

    // The 1-star review goes.
    await db.query(
      "update public.reviews set hidden_at = now(), hidden_by = $2, hidden_reason = 'abusive' where id = $1",
      [secondReviewId, admin],
    );

    const after = await ratingNow();
    expect(after.total_reviews, "hiding did not change the count").toBe(1);
    expect(Number(after.avg_rating), "hiding did not change the average").toBe(5);

    // And restoring puts it back — the trigger fires on both directions.
    await db.query(
      "update public.reviews set hidden_at = null, hidden_by = null, hidden_reason = null where id = $1",
      [secondReviewId],
    );
    const restored = await ratingNow();
    expect(restored.total_reviews).toBe(2);
    expect(Number(restored.avg_rating)).toBe(3);
  });

  it("makes the review invisible to the public and to the tutor, but not to its author", async () => {
    await db.query(
      "update public.reviews set hidden_at = now(), hidden_by = $2, hidden_reason = 'abusive' where id = $1",
      [secondReviewId, admin],
    );

    const asTutor = await runAs(db, user(tutor), "select id from public.reviews where id = $1", [
      secondReviewId,
    ]);
    expect(asTutor, "a hidden review was still visible to the tutor").toHaveLength(0);

    const asOutsider = await runAs(
      db,
      user(otherStudent),
      "select id from public.reviews where id = $1",
      [secondReviewId],
    );
    expect(asOutsider).toHaveLength(0);

    // The author keeps seeing it, so they are not silently censored.
    const asAuthor = await runAs(db, user(student), "select id from public.reviews where id = $1", [
      secondReviewId,
    ]);
    expect(asAuthor, "the author lost sight of their own review").toHaveLength(1);

    // And an admin can still review the decision.
    const asAdmin = await runAs(db, user(admin), "select id from public.reviews where id = $1", [
      secondReviewId,
    ]);
    expect(asAdmin).toHaveLength(1);
  });
});

/** A CHECK violation is 23514, which is not a security refusal. */
async function expectRefusedByConstraint(attempt: Promise<unknown>): Promise<void> {
  let err: { code?: string } | undefined;
  try {
    await attempt;
  } catch (e) {
    err = e as { code?: string };
  }
  expect(err, "the constraint accepted an unattributed hide").toBeDefined();
  expect(err?.code).toBe("23514");
}

// Referenced so the import is used even though every case above runs as a
// specific role; postgres is the operator escape hatch documented in 0035.
void postgres;
