import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  as,
  createTestDb,
  createTutorProfile,
  createUser,
  expectDenied,
  readRow,
  runAs,
  serviceRole,
  user,
  type Db,
} from "@/tests/db/harness";

/**
 * Migration 0028 — tutor_profiles columns the platform owns.
 *
 * The attacks being closed: a tutor holding their own session token could
 * write their own tutor_profiles row directly through PostgREST and set a 0%
 * commission, a payout destination, forged Connect state or a forged rating —
 * and on their FIRST profile save (an INSERT, which the 0003 verification
 * guard never covered) approve themselves. Every statement below runs with
 * the role and JWT claims PostgREST would use for that caller, against real
 * Postgres with every migration applied.
 */

const SYSTEM_CONTROLLED = /Stripe account state and ratings are system-controlled/;
const FEE_ADMIN_ONLY = /only an admin can change tutor_profiles\.platform_fee_bps/;
const INSERT_REFUSED = /tutor_profiles platform-controlled columns cannot be set by the tutor/;

let db: Db;
let student: string;
let admin: string;
/** Signed up as a tutor, has not saved a tutor profile yet. */
let tutorNew: string;
/** Pending review, no Stripe account, platform-default commission. */
let tutorPending: string;
/** Approved, fully onboarded, on a negotiated 15% commission. */
let tutorConnected: string;
/** Approved, but Stripe has restricted the account. */
let tutorRestricted: string;
let subjectId: number;
let completedBookingId: string;

beforeAll(async () => {
  db = await createTestDb();
  student = await createUser(db, "student", "Sam Student");
  admin = await createUser(db, "admin", "Ada Admin");
  tutorNew = await createUser(db, "tutor", "Nia New");
  tutorPending = await createUser(db, "tutor", "Pat Pending");
  tutorConnected = await createUser(db, "tutor", "Cal Connected");
  tutorRestricted = await createUser(db, "tutor", "Rae Restricted");

  await createTutorProfile(db, tutorPending);
  await createTutorProfile(db, tutorConnected, {
    verification_status: "approved",
    stripe_account_id: "acct_connected_tutor",
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    stripe_details_submitted: true,
    platform_fee_bps: 1500,
  });
  await createTutorProfile(db, tutorRestricted, {
    verification_status: "approved",
    stripe_account_id: "acct_restricted_tutor",
    stripe_details_submitted: true,
    stripe_requirements_due: ["individual.verification.document"],
    stripe_disabled_reason: "requirements.past_due",
  });

  const { rows } = await db.query<{ id: number }>(
    "insert into public.subjects (name, category, slug) values ('Spanish', 'Language', 'spanish') returning id",
  );
  subjectId = rows[0].id;

  const booking = await db.query<{ id: string }>(
    `insert into public.bookings
       (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes, status, price_cents, platform_fee_cents)
     values ($1, $2, $3, '2026-01-05 10:00+00', '2026-01-05 11:00+00', 60, 'completed', 5000, 750)
     returning id`,
    [student, tutorConnected, subjectId],
  );
  completedBookingId = booking.rows[0].id;
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("a tutor cannot modify platform-controlled financial fields", () => {
  it("refuses a tutor setting their own commission to 0%", async () => {
    await expectDenied(
      runAs(
        db,
        user(tutorPending),
        "update public.tutor_profiles set platform_fee_bps = 0 where id = $1",
        [tutorPending],
      ),
      FEE_ADMIN_ONLY,
    );
    expect((await readRow(db, "tutor_profiles", tutorPending))?.platform_fee_bps).toBeNull();
  });

  it("refuses a tutor lowering a commission rate an admin negotiated", async () => {
    await expectDenied(
      runAs(
        db,
        user(tutorConnected),
        "update public.tutor_profiles set platform_fee_bps = 500 where id = $1",
        [tutorConnected],
      ),
      FEE_ADMIN_ONLY,
    );
    expect((await readRow(db, "tutor_profiles", tutorConnected))?.platform_fee_bps).toBe(1500);
  });

  it.each([
    {
      column: "stripe_charges_enabled",
      value: "true",
      why: "unlock paid bookings Stripe never approved",
    },
    { column: "stripe_payouts_enabled", value: "true", why: "claim bank payouts are flowing" },
    { column: "stripe_details_submitted", value: "false", why: "misreport onboarding progress" },
    {
      column: "stripe_requirements_due",
      value: "'{}'::text[]",
      why: "hide what Stripe is asking for",
    },
    { column: "stripe_disabled_reason", value: "null", why: "hide a Stripe restriction" },
  ])("refuses a tutor forging $column to $why", async ({ column, value }) => {
    const before = await readRow(db, "tutor_profiles", tutorRestricted);

    await expectDenied(
      runAs(
        db,
        user(tutorRestricted),
        `update public.tutor_profiles set ${column} = ${value} where id = $1`,
        [tutorRestricted],
      ),
      SYSTEM_CONTROLLED,
    );
    expect(await readRow(db, "tutor_profiles", tutorRestricted)).toEqual(before);
  });

  it.each([
    { column: "avg_rating", value: "5.0" },
    { column: "total_reviews", value: "400" },
  ])("refuses a tutor faking their $column", async ({ column, value }) => {
    const before = await readRow(db, "tutor_profiles", tutorPending);

    await expectDenied(
      runAs(
        db,
        user(tutorPending),
        `update public.tutor_profiles set ${column} = ${value} where id = $1`,
        [tutorPending],
      ),
      SYSTEM_CONTROLLED,
    );
    expect(await readRow(db, "tutor_profiles", tutorPending)).toEqual(before);
  });
});

describe("a tutor cannot redirect Stripe payouts to another account", () => {
  const SET_ACCOUNT = "update public.tutor_profiles set stripe_account_id = $2 where id = $1";

  it("refuses a tutor attaching a Stripe account id to their own profile", async () => {
    // The column is locked even from NULL: the only legitimate value is the
    // one Stripe returns to startTutorOnboarding, written by the service role.
    await expectDenied(
      runAs(db, user(tutorPending), SET_ACCOUNT, [tutorPending, "acct_attacker_controlled"]),
      SYSTEM_CONTROLLED,
    );
    expect((await readRow(db, "tutor_profiles", tutorPending))?.stripe_account_id).toBeNull();
  });

  it("refuses a tutor claiming another tutor's connected account", async () => {
    // Also a denial of service on the victim: the webhook resolves tutors by
    // stripe_account_id with maybeSingle(), which errors on a duplicate.
    await expectDenied(
      runAs(db, user(tutorPending), SET_ACCOUNT, [tutorPending, "acct_connected_tutor"]),
      SYSTEM_CONTROLLED,
    );
    expect((await readRow(db, "tutor_profiles", tutorPending))?.stripe_account_id).toBeNull();
  });

  it("refuses a tutor swapping their connected account for a different one", async () => {
    await expectDenied(
      runAs(db, user(tutorConnected), SET_ACCOUNT, [tutorConnected, "acct_attacker_controlled"]),
      SYSTEM_CONTROLLED,
    );
    expect((await readRow(db, "tutor_profiles", tutorConnected))?.stripe_account_id).toBe(
      "acct_connected_tutor",
    );
  });

  it("refuses a tutor detaching their connected account", async () => {
    await expectDenied(
      runAs(db, user(tutorConnected), SET_ACCOUNT, [tutorConnected, null]),
      SYSTEM_CONTROLLED,
    );
    expect((await readRow(db, "tutor_profiles", tutorConnected))?.stripe_account_id).toBe(
      "acct_connected_tutor",
    );
  });
});

describe("a tutor's first profile save cannot smuggle platform values in", () => {
  const firstSaveWith = (column: string, value: string) =>
    runAs(
      db,
      user(tutorNew),
      `insert into public.tutor_profiles (id, headline, bio, hourly_rate_cents, ${column})
       values ($1, 'Headline', 'Bio', 5000, ${value})`,
      [tutorNew],
    );

  it("refuses self-approval on the first save — the INSERT path the 0003 guard never covered", async () => {
    await expectDenied(firstSaveWith("verification_status", "'approved'"), INSERT_REFUSED);
    expect(await readRow(db, "tutor_profiles", tutorNew)).toBeUndefined();
  });

  it.each([
    { column: "platform_fee_bps", value: "0" },
    { column: "stripe_account_id", value: "'acct_attacker_controlled'" },
    { column: "stripe_charges_enabled", value: "true" },
    { column: "stripe_payouts_enabled", value: "true" },
    { column: "stripe_details_submitted", value: "true" },
    { column: "stripe_requirements_due", value: "array['external_account']::text[]" },
    { column: "stripe_disabled_reason", value: "'under_review'" },
    { column: "avg_rating", value: "5.0" },
    { column: "total_reviews", value: "400" },
  ])("refuses $column on the first save", async ({ column, value }) => {
    await expectDenied(firstSaveWith(column, value), INSERT_REFUSED);
    expect(await readRow(db, "tutor_profiles", tutorNew)).toBeUndefined();
  });
});

describe("legitimate tutor profile saves still work", () => {
  // The same statement shape PostgREST builds for upsertTutorProfile's
  // `.upsert(payload, { onConflict: "id" })` (lib/actions/profile.ts): an
  // INSERT of exactly the payload columns that turns into an UPDATE of those
  // same columns when the row already exists.
  const UPSERT_TUTOR_PROFILE = `
    insert into public.tutor_profiles (
      id, headline, bio, languages_spoken, teaching_languages, specializations,
      years_experience, certifications, education, hourly_rate_cents,
      trial_price_cents, availability_note, video_url
    ) values ($1, $2, 'A real bio', array['English'], array['English'], array['IELTS'],
              5, array['CELTA'], 'BA English', 4500, 1500, 'Weekday evenings',
              'https://example.test/intro')
    on conflict (id) do update set
      headline = excluded.headline,
      bio = excluded.bio,
      languages_spoken = excluded.languages_spoken,
      teaching_languages = excluded.teaching_languages,
      specializations = excluded.specializations,
      years_experience = excluded.years_experience,
      certifications = excluded.certifications,
      education = excluded.education,
      hourly_rate_cents = excluded.hourly_rate_cents,
      trial_price_cents = excluded.trial_price_cents,
      availability_note = excluded.availability_note,
      video_url = excluded.video_url
    returning headline, hourly_rate_cents, verification_status, stripe_account_id,
              stripe_charges_enabled, stripe_payouts_enabled, platform_fee_bps,
              avg_rating, total_reviews`;

  it("lets a new tutor create their profile with the upsert the app sends", async () => {
    const rows = await runAs(db, user(tutorNew), UPSERT_TUTOR_PROFILE, [tutorNew, "First save"]);

    expect(rows).toEqual([
      {
        headline: "First save",
        hourly_rate_cents: 4500,
        verification_status: "pending",
        stripe_account_id: null,
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
        platform_fee_bps: null,
        avg_rating: null,
        total_reviews: 0,
      },
    ]);
  });

  it("lets an approved, connected tutor re-save without disturbing any platform column", async () => {
    const rows = await runAs(db, user(tutorConnected), UPSERT_TUTOR_PROFILE, [
      tutorConnected,
      "Edited headline",
    ]);

    expect(rows).toEqual([
      {
        headline: "Edited headline",
        hourly_rate_cents: 4500,
        verification_status: "approved",
        stripe_account_id: "acct_connected_tutor",
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        platform_fee_bps: 1500,
        avg_rating: null,
        total_reviews: 0,
      },
    ]);
  });

  it("lets a tutor change their own prices", async () => {
    const rows = await runAs(
      db,
      user(tutorConnected),
      "update public.tutor_profiles set hourly_rate_cents = 6500, trial_price_cents = 2000 where id = $1 returning hourly_rate_cents, trial_price_cents",
      [tutorConnected],
    );
    expect(rows).toEqual([{ hourly_rate_cents: 6500, trial_price_cents: 2000 }]);
  });
});

describe("trusted writers are unaffected", () => {
  it("lets the service role mirror Stripe account state — the account.updated webhook path", async () => {
    const rows = await runAs(
      db,
      serviceRole,
      `update public.tutor_profiles
       set stripe_charges_enabled = true, stripe_payouts_enabled = true,
           stripe_details_submitted = true, stripe_requirements_due = '{}',
           stripe_disabled_reason = null
       where id = $1
       returning stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements_due, stripe_disabled_reason`,
      [tutorRestricted],
    );
    expect(rows).toEqual([
      {
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        stripe_requirements_due: [],
        stripe_disabled_reason: null,
      },
    ]);
  });

  it("lets the service role link a new Stripe account — the startTutorOnboarding path", async () => {
    const rows = await runAs(
      db,
      serviceRole,
      "update public.tutor_profiles set stripe_account_id = 'acct_from_stripe' where id = $1 returning stripe_account_id",
      [tutorPending],
    );
    expect(rows).toEqual([{ stripe_account_id: "acct_from_stripe" }]);
  });

  it("lets an admin set a tutor's commission rate", async () => {
    const rows = await runAs(
      db,
      user(admin),
      "update public.tutor_profiles set platform_fee_bps = 800 where id = $1 returning platform_fee_bps",
      [tutorPending],
    );
    expect(rows).toEqual([{ platform_fee_bps: 800 }]);
  });

  it("does not let an admin's own session forge Stripe state either", async () => {
    await expectDenied(
      runAs(
        db,
        user(admin),
        "update public.tutor_profiles set stripe_charges_enabled = true where id = $1",
        [tutorRestricted],
      ),
      SYSTEM_CONTROLLED,
    );
  });

  it("keeps the existing 0003 guard: a tutor cannot approve themselves, an admin can", async () => {
    const APPROVE =
      "update public.tutor_profiles set verification_status = 'approved' where id = $1 returning verification_status";

    await expect(runAs(db, user(tutorPending), APPROVE, [tutorPending])).rejects.toThrow(
      /only an admin can change tutor verification_status/,
    );
    expect(await runAs(db, user(admin), APPROVE, [tutorPending])).toEqual([
      { verification_status: "approved" },
    ]);
  });

  it("still lets a student's review recompute the tutor's rating — the path an auth.role() clone would break", async () => {
    // recompute_tutor_rating (0008) writes avg_rating from inside a SECURITY
    // DEFINER function while the request still carries the student's JWT.
    const rating = await as(db, user(student), async () => {
      await db.query(
        "insert into public.reviews (booking_id, student_id, tutor_id, rating) values ($1, $2, $3, 5)",
        [completedBookingId, student, tutorConnected],
      );
      const { rows } = await db.query<{ avg_rating: string; total_reviews: number }>(
        "select avg_rating, total_reviews from public.tutor_profiles where id = $1",
        [tutorConnected],
      );
      return rows[0];
    });

    expect(Number(rating.avg_rating)).toBe(5);
    expect(rating.total_reviews).toBe(1);
  });
});

describe("existing booking and payment behaviour at the database level", () => {
  const INSERT_BOOKING = `
    insert into public.bookings
      (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes, price_cents, platform_fee_cents)
    values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '60 minutes', 60, 5000, 750)
    returning status, price_cents, platform_fee_cents`;

  it("still lets a student book an approved tutor", async () => {
    const rows = await runAs(db, user(student), INSERT_BOOKING, [
      student,
      tutorConnected,
      subjectId,
      "2030-03-04 10:00+00",
    ]);
    expect(rows).toEqual([
      { status: "pending_payment", price_cents: 5000, platform_fee_cents: 750 },
    ]);
  });

  it("still rejects double-booking the same tutor slot", async () => {
    await expect(
      as(db, user(student), async () => {
        await db.query(INSERT_BOOKING, [student, tutorConnected, subjectId, "2030-03-04 10:00+00"]);
        await db.query(INSERT_BOOKING, [student, tutorConnected, subjectId, "2030-03-04 10:30+00"]);
      }),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("still refuses any client write to payments", async () => {
    await expectDenied(
      runAs(
        db,
        user(student),
        "insert into public.payments (booking_id, amount_cents, status) values ($1, 5000, 'succeeded')",
        [completedBookingId],
      ),
      /permission denied for table payments/,
    );
  });
});
