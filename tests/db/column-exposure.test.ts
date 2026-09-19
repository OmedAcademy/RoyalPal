import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestDb,
  as,
  runAs,
  createUser,
  createTutorProfile,
  serviceRole,
  user,
  type Db,
} from "./harness";

/**
 * Column-level exposure on profiles and tutor_profiles (migration 0041).
 *
 * Row Level Security filters ROWS. It cannot scope COLUMNS. Three policies
 * written to share a tutor's display name were therefore also sharing their
 * date of birth, phone number, connected-account id and negotiated commission
 * rate — one of them to callers with no account at all.
 *
 * These tests assert the refusal, not the absence of a value: a withheld
 * column does not come back null, PostgreSQL refuses the whole statement. That
 * distinction matters, because "returns null" is what a mistaken `select` in
 * application code produces, and it would leave the database still willing to
 * answer the question to anyone who asked it directly through PostgREST.
 */
describe("column exposure", () => {
  let db: Db;
  let tutor: string;
  let student: string;
  let stranger: string;
  let admin: string;

  const SENSITIVE_TUTOR_COLUMNS = [
    "stripe_account_id",
    "platform_fee_bps",
    "stripe_disabled_reason",
    "stripe_requirements_due",
    "stripe_payouts_enabled",
    "stripe_details_submitted",
  ];

  beforeAll(async () => {
    db = await createTestDb();
    tutor = await createUser(db, "tutor", "Tara Tutor");
    student = await createUser(db, "student", "Sam Student");
    stranger = await createUser(db, "student", "Nosy Stranger");
    admin = await createUser(db, "admin", "Ada Admin");
    await createTutorProfile(db, tutor, {
      verification_status: "approved",
      stripe_account_id: "acct_1TutorSecret",
      platform_fee_bps: 700,
      stripe_disabled_reason: "requirements.past_due",
      stripe_requirements_due: ["individual.verification.document"],
    });
    await db.query(`update public.profiles set phone = '+44 7700 900000' where id = $1`, [tutor]);
    await db.query(
      `insert into public.subjects (id, name, slug, category) values (1, 'English', 'english', 'lang')
       on conflict do nothing`,
    );
    // A shared booking, so the booking-participant policy (0016) applies.
    await db.query(
      `insert into public.bookings
         (student_id, tutor_id, subject_id, start_at, end_at, lesson_duration_minutes,
          price_cents, platform_fee_cents, currency, status)
       values ($1, $2, 1, now() + interval '3 days', now() + interval '3 days 1 hour',
               60, 5000, 500, 'usd', 'confirmed')`,
      [student, tutor],
    );
    await db.query(
      `insert into public.availability_rules (tutor_id, day_of_week, start_time, end_time)
       values ($1, 1, '09:00', '17:00')`,
      [tutor],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  /** Reads one column as a fully anonymous caller (no JWT at all). */
  async function readAsAnon(sql: string, params: unknown[] = []): Promise<unknown[]> {
    await db.exec("begin");
    try {
      await db.exec("set local role anon");
      const { rows } = await db.query(sql, params);
      return rows;
    } finally {
      await db.exec("rollback");
    }
  }

  // TEST 1 ------------------------------------------------------------------
  describe("an unauthenticated caller", () => {
    for (const column of SENSITIVE_TUTOR_COLUMNS) {
      it(`cannot read tutor_profiles.${column}`, async () => {
        await expect(
          readAsAnon(`select ${column} from public.tutor_profiles where id = $1`, [tutor]),
        ).rejects.toThrow(/permission denied/i);
      });
    }

    it("cannot read them via select *", async () => {
      // The whole-row shortcut has to fail too, or the revoke is decorative.
      await expect(
        readAsAnon(`select * from public.tutor_profiles where id = $1`, [tutor]),
      ).rejects.toThrow(/permission denied/i);
    });

    it("cannot read profiles at all", async () => {
      await expect(readAsAnon(`select id from public.profiles limit 1`)).rejects.toThrow(
        /permission denied/i,
      );
    });
  });

  // TEST 2 ------------------------------------------------------------------
  describe("public availability still works for an unauthenticated caller", () => {
    it("can still read an approved tutor's availability", async () => {
      // The policy on availability_rules subqueries tutor_profiles, and
      // Postgres checks table privileges inside a policy expression against
      // the querying role — so revoking anon outright broke this. anon keeps
      // exactly id and verification_status for that reason.
      const rows = await readAsAnon(
        `select day_of_week from public.availability_rules where tutor_id = $1`,
        [tutor],
      );
      expect(rows).toHaveLength(1);
    });

    it("can still read the two columns that policy needs, and no more", async () => {
      const rows = await readAsAnon(
        `select id, verification_status from public.tutor_profiles where id = $1`,
        [tutor],
      );
      expect(rows).toHaveLength(1);
      await expect(
        readAsAnon(`select headline from public.tutor_profiles where id = $1`, [tutor]),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // TEST 3 ------------------------------------------------------------------
  describe("an authenticated student viewing an approved tutor", () => {
    it("cannot read the tutor's date_of_birth", async () => {
      await expect(
        runAs(db, user(stranger), `select date_of_birth from public.profiles where id = $1`, [
          tutor,
        ]),
      ).rejects.toThrow(/permission denied/i);
    });

    it("cannot read the tutor's phone", async () => {
      await expect(
        runAs(db, user(stranger), `select phone from public.profiles where id = $1`, [tutor]),
      ).rejects.toThrow(/permission denied/i);
    });

    for (const column of SENSITIVE_TUTOR_COLUMNS) {
      it(`cannot read tutor_profiles.${column}`, async () => {
        await expect(
          runAs(db, user(stranger), `select ${column} from public.tutor_profiles where id = $1`, [
            tutor,
          ]),
        ).rejects.toThrow(/permission denied/i);
      });
    }

    it("cannot reach them through select * on either table", async () => {
      await expect(
        runAs(db, user(stranger), `select * from public.profiles where id = $1`, [tutor]),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        runAs(db, user(stranger), `select * from public.tutor_profiles where id = $1`, [tutor]),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // TEST 4 ------------------------------------------------------------------
  describe("a booking participant", () => {
    it("cannot read the other participant's date_of_birth", async () => {
      // Nothing in the product needs it. The lesson needs a name, a time zone
      // and a conversation; none of that is a date of birth.
      await expect(
        runAs(db, user(tutor), `select date_of_birth from public.profiles where id = $1`, [
          student,
        ]),
      ).rejects.toThrow(/permission denied/i);
    });

    it("cannot read the other participant's phone", async () => {
      await expect(
        runAs(db, user(tutor), `select phone from public.profiles where id = $1`, [student]),
      ).rejects.toThrow(/permission denied/i);
    });

    it("can still read the other participant's name, which the lesson needs", async () => {
      const rows = await runAs<{ full_name: string }>(
        db,
        user(tutor),
        `select full_name from public.profiles where id = $1`,
        [student],
      );
      expect(rows[0]?.full_name).toBe("Sam Student");
    });
  });

  // TEST 5 ------------------------------------------------------------------
  describe("privileged access is preserved", () => {
    it("the service role still reads every withheld column", async () => {
      // Checkout's destination charge, Connect onboarding, the payouts page,
      // the admin console and the Stripe webhooks all depend on this.
      const rows = await runAs<Record<string, unknown>>(
        db,
        serviceRole,
        `select stripe_account_id, platform_fee_bps, stripe_disabled_reason,
                stripe_requirements_due, stripe_payouts_enabled, stripe_details_submitted
           from public.tutor_profiles where id = $1`,
        [tutor],
      );
      expect(rows[0].stripe_account_id).toBe("acct_1TutorSecret");
      expect(rows[0].platform_fee_bps).toBe(700);
    });

    it("the service role still reads profiles in full", async () => {
      const rows = await runAs<Record<string, unknown>>(
        db,
        serviceRole,
        `select date_of_birth, phone from public.profiles where id = $1`,
        [tutor],
      );
      expect(rows[0].phone).toBe("+44 7700 900000");
      expect(rows[0].date_of_birth).not.toBeNull();
    });

    it("an ADMIN signing in through PostgREST is still a client, and still refused", async () => {
      // Column privileges are role-based, not row-based: `admin` is a row in
      // profiles, not a database role, so an admin's own session is still the
      // `authenticated` role. The admin console reads these columns through
      // the service role, which is the boundary this test pins.
      await expect(
        runAs(db, user(admin), `select platform_fee_bps from public.tutor_profiles where id = $1`, [
          tutor,
        ]),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // TEST 6 ------------------------------------------------------------------
  describe("tutor discovery still works", () => {
    it("serves every column the search query selects", async () => {
      // Mirrors TUTOR_SELECT in lib/supabase/tutor-search.ts exactly. If this
      // drifts, discovery breaks in production and nothing else would say so.
      const rows = await runAs<Record<string, unknown>>(
        db,
        user(stranger),
        `select id, headline, bio, hourly_rate_cents, trial_price_cents, currency,
                teaching_languages, specializations, avg_rating, total_reviews,
                video_url, stripe_charges_enabled
           from public.tutor_profiles where id = $1`,
        [tutor],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].headline).toBe("Seeded headline");
    });

    it("serves the embedded profile columns search joins", async () => {
      const rows = await runAs<Record<string, unknown>>(
        db,
        user(stranger),
        `select full_name, avatar_url, country, timezone from public.profiles where id = $1`,
        [tutor],
      );
      expect(rows[0].full_name).toBe("Tara Tutor");
    });
  });

  // TEST 7 ------------------------------------------------------------------
  describe("the profile contracts web and mobile depend on", () => {
    it("serves every column PROFILE_CLIENT_COLUMNS asks for, on your own row", async () => {
      const rows = await runAs<Record<string, unknown>>(
        db,
        user(student),
        `select id, role, full_name, avatar_url, country, timezone, status, created_at,
                updated_at, age_confirmed_at, terms_accepted_at, terms_version,
                deletion_requested_at, anonymized_at
           from public.profiles where id = $1`,
        [student],
      );
      expect(rows).toHaveLength(1);
    });

    it("serves every column TUTOR_PROFILE_CLIENT_COLUMNS asks for, on your own row", async () => {
      const rows = await runAs<Record<string, unknown>>(
        db,
        user(tutor),
        `select id, headline, bio, video_url, hourly_rate_cents, trial_price_cents, currency,
                languages_spoken, teaching_languages, specializations, years_experience,
                certifications, education, availability_note, verification_status, avg_rating,
                total_reviews, stripe_charges_enabled, rejection_reason, rejection_notes,
                verification_decided_at, verification_decided_by, created_at, updated_at
           from public.tutor_profiles where id = $1`,
        [tutor],
      );
      expect(rows).toHaveLength(1);
    });

    it("does NOT let a tutor read their own Stripe state as a client", async () => {
      // Deliberate, and the reason the payouts page moved to the service role:
      // column privileges cannot tell "my row" from "someone else's", so the
      // only way to withhold a column from strangers is to withhold it from
      // everyone and let privileged code hand it back.
      await expect(
        runAs(
          db,
          user(tutor),
          `select stripe_account_id from public.tutor_profiles where id = $1`,
          [tutor],
        ),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // SECURITY INVOKER trigger functions -----------------------------------------
  describe("the SECURITY INVOKER functions that touch withheld columns", () => {
    /**
     * protect_tutor_platform_columns (0028) and protect_profile_date_of_birth
     * (0036) both run as the CALLING role and both read columns that 0041
     * withholds from `authenticated`.
     *
     * They keep working because a trigger function reads NEW and OLD as
     * in-memory records rather than selecting from the table, so column
     * privileges never enter into it. That is a claim worth executing rather
     * than believing: if it were wrong, every tutor profile save and every
     * profile update would fail with "permission denied for column" the moment
     * 0041 landed, and the failure would look like a broken product rather
     * than a permissions change.
     */
    it("protect_tutor_platform_columns still fires for an authenticated writer", async () => {
      // A legitimate edit: the trigger reads NEW.stripe_account_id et al to
      // compare them against OLD, and must allow this through.
      await as(db, user(tutor), async () => {
        const { rows } = await db.query(
          `update public.tutor_profiles set headline = 'Edited by the tutor'
            where id = $1 returning headline`,
          [tutor],
        );
        expect(rows).toEqual([{ headline: "Edited by the tutor" }]);
      });
    });

    it("protect_tutor_platform_columns still REFUSES a forged platform column", async () => {
      // And the refusal it exists for still happens — proving the trigger ran
      // rather than being skipped.
      await as(db, user(tutor), async () => {
        await expect(
          db.query(`update public.tutor_profiles set platform_fee_bps = 1 where id = $1`, [tutor]),
        ).rejects.toThrow(/platform-controlled|only|denied/i);
      });
    });

    it("protect_profile_date_of_birth still fires for an authenticated writer", async () => {
      await as(db, user(student), async () => {
        const { rows } = await db.query(
          `update public.profiles set full_name = 'Renamed' where id = $1 returning full_name`,
          [student],
        );
        expect(rows).toEqual([{ full_name: "Renamed" }]);
      });
    });

    it("protect_profile_date_of_birth still REFUSES a rewrite of a set date_of_birth", async () => {
      await as(db, user(student), async () => {
        await expect(
          db.query(`update public.profiles set date_of_birth = '2000-01-01' where id = $1`, [
            student,
          ]),
        ).rejects.toThrow(/date of birth|denied|once/i);
      });
    });
  });

  // TEST 8 ------------------------------------------------------------------
  describe("no new broad access was introduced", () => {
    it("grants anon SELECT on no table beyond the documented set", async () => {
      // has_table_privilege rather than information_schema: those views only
      // show privileges involving a currently enabled role, so asking about
      // `anon` while connected as anything else returns an empty set and the
      // assertion passes for the wrong reason.
      const rows = await runAs<{ relname: string }>(
        db,
        serviceRole,
        `select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'v')
            and has_table_privilege('anon', c.oid, 'SELECT')
          order by c.relname`,
      );
      // tutor_profiles is deliberately absent: has_table_privilege answers for
      // TABLE-level SELECT, and 0041 replaced anon's table grant with a
      // two-column one. Its absence here is the fix working, and the next test
      // pins which two columns survived.
      expect(rows.map((r) => r.relname)).toEqual([
        "availability_exceptions",
        "availability_rules",
        "reviews",
        "subjects",
        "tutor_subjects",
      ]);
    });

    it("leaves anon exactly two columns on tutor_profiles", async () => {
      const rows = await runAs<{ attname: string }>(
        db,
        serviceRole,
        `select a.attname from pg_attribute a
          where a.attrelid = 'public.tutor_profiles'::regclass
            and a.attnum > 0 and not a.attisdropped
            and has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT')
          order by a.attname`,
      );
      expect(rows.map((r) => r.attname)).toEqual(["id", "verification_status"]);
    });

    it("withholds phone and date_of_birth from authenticated", async () => {
      const rows = await runAs<{ attname: string }>(
        db,
        serviceRole,
        `select a.attname from pg_attribute a
          where a.attrelid = 'public.profiles'::regclass
            and a.attname in ('phone', 'date_of_birth')
            and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')`,
      );
      expect(rows).toEqual([]);
    });

    it("adds no PUBLIC or anon EXECUTE privilege", async () => {
      // 0041 is grants only; this guards against a future edit smuggling one in.
      const rows = await runAs<{ proname: string }>(
        db,
        serviceRole,
        `select p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and pg_get_function_result(p.oid) <> 'trigger'
            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
            and has_function_privilege('anon', p.oid, 'EXECUTE')
            and p.proname <> 'is_admin'`,
      );
      expect(rows).toEqual([]);
    });

    it("keeps RLS enabled on both tables", async () => {
      const rows = await runAs<{ relname: string; relrowsecurity: boolean }>(
        db,
        serviceRole,
        `select c.relname, c.relrowsecurity from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname in ('profiles', 'tutor_profiles')`,
      );
      expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    });

    it("leaves the row policies untouched", async () => {
      // 0041 changes privileges only. If a policy was dropped, row visibility
      // changed too, and that is a different and much riskier kind of fix.
      const rows = await runAs<{ policyname: string }>(
        db,
        serviceRole,
        `select policyname from pg_policies
          where schemaname = 'public' and tablename = 'profiles' order by policyname`,
      );
      expect(rows.map((r) => r.policyname)).toEqual([
        "profiles_insert_own",
        "profiles_select_booking_participant",
        "profiles_select_own_or_admin",
        "profiles_select_public_approved_tutor",
        "profiles_update_own_or_admin",
      ]);
    });
  });
});
