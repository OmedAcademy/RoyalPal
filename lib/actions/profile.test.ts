import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * Profile Server Actions — the application half of migrations 0027/0028.
 *
 * The database now refuses platform-controlled columns from any user
 * session. These tests pin the defence-in-depth half: both actions build
 * their write payloads from an explicit allowlist of parsed form fields, so
 * a hostile form carrying role/status/commission/Stripe fields never reaches
 * the query at all. If a future refactor spreads form data or an existing
 * row into a payload, these fail before the database has to catch it.
 */

const STUDENT = "33333333-3333-4333-8333-333333333333";
const TUTOR = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateStudentProfile, upsertTutorProfile } = await import("@/lib/actions/profile");

/** Every platform-controlled field a hostile client might post, plus an
 * attempt to retarget the write at somebody else's row. */
const HOSTILE_FIELDS: Record<string, string> = {
  id: OTHER_USER,
  role: "admin",
  status: "active",
  verification_status: "approved",
  platform_fee_bps: "0",
  stripe_account_id: "acct_attacker_controlled",
  stripe_charges_enabled: "true",
  stripe_payouts_enabled: "true",
  stripe_details_submitted: "true",
  stripe_disabled_reason: "",
  avg_rating: "5",
  total_reviews: "400",
};

function withHostileFields(fd: FormData): FormData {
  for (const [name, value] of Object.entries(HOSTILE_FIELDS)) fd.set(name, value);
  return fd;
}

function studentForm(): FormData {
  const fd = new FormData();
  fd.set("fullName", "Sam Updated");
  fd.set("country", "Ireland");
  fd.set("timezone", "Europe/Dublin");
  fd.set("nativeLanguage", "English");
  fd.append("targetLanguages", "Spanish");
  fd.set("englishLevel", "B2");
  fd.set("learningGoals", "Hold a conversation");
  return fd;
}

function tutorForm(): FormData {
  const fd = new FormData();
  fd.set("fullName", "Tia Updated");
  fd.set("headline", "Patient IELTS coach");
  fd.set("bio", "Ten years of exam preparation.");
  fd.append("languagesSpoken", "English");
  fd.append("teachingLanguages", "English");
  fd.append("specializations", "IELTS");
  fd.set("yearsExperience", "10");
  fd.set("certifications", "CELTA");
  fd.set("education", "BA English");
  fd.set("hourlyPrice", "45");
  fd.set("trialPrice", "15");
  fd.set("availabilityNote", "Weekday evenings");
  fd.set("country", "United Kingdom");
  fd.set("timezone", "Europe/London");
  fd.set("videoUrl", "https://example.test/intro");
  return fd;
}

/** Exactly the columns upsertTutorProfile is allowed to write. */
const TUTOR_EDITABLE_COLUMNS = [
  "id",
  "headline",
  "bio",
  "languages_spoken",
  "teaching_languages",
  "specializations",
  "years_experience",
  "certifications",
  "education",
  "hourly_rate_cents",
  "trial_price_cents",
  "availability_note",
  "video_url",
];

const OTHER_PROFILE = {
  id: OTHER_USER,
  role: "student",
  status: "active",
  full_name: "Someone Else",
  country: null,
  timezone: "UTC",
};

function seed(opts: { tutorRow?: Record<string, unknown> } = {}) {
  fake = createFakeSupabase({
    profiles: [
      {
        id: STUDENT,
        role: "student",
        status: "active",
        full_name: "Sam Student",
        country: null,
        timezone: "UTC",
      },
      {
        id: TUTOR,
        role: "tutor",
        status: "active",
        full_name: "Tia Tutor",
        country: null,
        timezone: "UTC",
      },
      OTHER_PROFILE,
    ],
    student_profiles: [{ id: STUDENT }, { id: OTHER_USER }],
    tutor_profiles: opts.tutorRow ? [opts.tutorRow] : [],
    tutor_subjects: [],
  });
}

function signInAs(id: string) {
  fake.client.auth.getUser = async () => ({ data: { user: { id } }, error: null });
}

beforeEach(() => {
  seed();
});

describe("updateStudentProfile", () => {
  it("saves the student's own editable fields", async () => {
    signInAs(STUDENT);

    const res = await updateStudentProfile({}, studentForm());

    expect(res).toEqual({ message: "Profile saved" });
    expect(fake.db.student_profiles[0]).toEqual({
      id: STUDENT,
      native_language: "English",
      target_languages: ["Spanish"],
      english_level: "B2",
      learning_goals: "Hold a conversation",
    });
  });

  it("never writes role, status or any platform field from a hostile form", async () => {
    signInAs(STUDENT);

    const res = await updateStudentProfile({}, withHostileFields(studentForm()));

    expect(res).toEqual({ message: "Profile saved" });
    // toEqual on the whole row: any smuggled key would make this fail.
    expect(fake.db.profiles[0]).toEqual({
      id: STUDENT,
      role: "student",
      status: "active",
      full_name: "Sam Updated",
      country: "Ireland",
      timezone: "Europe/Dublin",
    });
    expect(fake.db.profiles[2]).toEqual(OTHER_PROFILE);
  });
});

describe("upsertTutorProfile", () => {
  it("creates a new tutor's profile from editable columns only, however hostile the form", async () => {
    signInAs(TUTOR);

    const res = await upsertTutorProfile({}, withHostileFields(tutorForm()));

    expect(res).toEqual({ message: "Profile saved" });
    expect(fake.db.tutor_profiles).toHaveLength(1);
    const created = fake.db.tutor_profiles[0];
    expect(Object.keys(created).sort()).toEqual([...TUTOR_EDITABLE_COLUMNS].sort());
    expect(created.id).toBe(TUTOR);
    expect(created.hourly_rate_cents).toBe(4500);
    expect(fake.db.profiles[1]).toMatchObject({ role: "tutor", status: "active" });
  });

  it("leaves an onboarded tutor's platform columns untouched when they re-save", async () => {
    const platformState = {
      verification_status: "approved",
      platform_fee_bps: 1500,
      stripe_account_id: "acct_connected_tutor",
      stripe_charges_enabled: true,
      stripe_payouts_enabled: true,
      stripe_details_submitted: true,
      stripe_disabled_reason: null,
      avg_rating: 4.8,
      total_reviews: 12,
    };
    seed({ tutorRow: { id: TUTOR, headline: "Old headline", ...platformState } });
    signInAs(TUTOR);

    const res = await upsertTutorProfile({}, withHostileFields(tutorForm()));

    expect(res).toEqual({ message: "Profile saved" });
    expect(fake.db.tutor_profiles[0]).toMatchObject({
      id: TUTOR,
      headline: "Patient IELTS coach",
      ...platformState,
    });
  });
});
