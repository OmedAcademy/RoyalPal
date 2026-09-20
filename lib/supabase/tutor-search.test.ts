import { describe, it, expect, vi } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * getTutorById on a malformed id — the web half of MOB-3.
 *
 * `/tutor/profile` reaches `tutor/[id]` on both platforms, and the id it hands
 * down is the literal string "profile". Postgres does not shrug at that: a
 * uuid comparison against a non-uuid raises 22P02, the query throws, and the
 * request becomes a 500 on a screen that looked perfectly plausible.
 *
 * A tutor who does not exist is a 404. A tutor id that cannot exist is the
 * same answer, reached earlier.
 */

const TUTOR = "99999999-9999-4999-8999-999999999999";

let fake: ReturnType<typeof createFakeSupabase>;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.client }));

const { getTutorById, searchTutors } = await import("@/lib/supabase/tutor-search");

function seed() {
  fake = createFakeSupabase(
    {
      tutor_profiles: [
        {
          id: TUTOR,
          headline: "Maths, patiently",
          bio: "",
          hourly_rate_cents: 3000,
          trial_price_cents: null,
          currency: "GBP",
          teaching_languages: ["en"],
          specializations: [],
          avg_rating: null,
          total_reviews: 0,
          video_url: null,
          stripe_charges_enabled: true,
          verification_status: "approved",
          profiles: { full_name: "Grace", avatar_url: null },
          tutor_subjects: [],
        },
      ],
      profiles: [{ id: TUTOR, role: "tutor", status: "active" }],
    },
    null,
    // The columns the real schema types as uuid, so a bad id fails here the
    // way it fails in Postgres instead of quietly matching nothing.
    { uuidColumns: ["id"] },
  );
}

describe("getTutorById — an id that cannot exist", () => {
  it("returns null for a path segment that is not an id", async () => {
    seed();

    await expect(getTutorById("profile")).resolves.toBeNull();
  });

  it("returns null for the other colliding web path", async () => {
    seed();

    await expect(getTutorById("payouts")).resolves.toBeNull();
  });

  it("returns null for an empty id rather than querying for it", async () => {
    seed();

    await expect(getTutorById("")).resolves.toBeNull();
  });

  it("still finds a real tutor", async () => {
    // The guard must not swallow the working case it is wrapped around.
    seed();

    const tutor = await getTutorById(TUTOR);

    expect(tutor?.id).toBe(TUTOR);
    expect(tutor?.full_name).toBe("Grace");
  });
});

/**
 * MOB-11 — the search box promises "Name or subject" and delivers name.
 *
 * `q` matched full_name and headline only. A subject is a first-class thing on
 * this marketplace — it has its own table, its own filter and its own column
 * on the tutor — and typing one into the search box returned nothing at all.
 * Not "no tutors teach that": nothing, silently, for a word the placeholder
 * invited.
 */
describe("searchTutors — what the search box actually searches", () => {
  const BY_NAME = "aaaaaaaa-1111-4111-8111-111111111111";
  const BY_HEADLINE = "bbbbbbbb-1111-4111-8111-111111111111";
  const BY_SUBJECT = "cccccccc-1111-4111-8111-111111111111";
  const ELSEWHERE = "dddddddd-1111-4111-8111-111111111111";

  function tutorRow(id: string, headline: string) {
    return {
      id,
      headline,
      bio: "",
      hourly_rate_cents: 3000,
      trial_price_cents: null,
      currency: "GBP",
      teaching_languages: ["en"],
      specializations: [],
      avg_rating: null,
      total_reviews: 0,
      video_url: null,
      stripe_charges_enabled: true,
      verification_status: "approved",
      created_at: "2026-01-01T00:00:00.000Z",
      profiles: { full_name: "Someone", avatar_url: null },
      tutor_subjects: [],
    };
  }

  function seedMarket() {
    fake = createFakeSupabase({
      tutor_profiles: [
        {
          ...tutorRow(BY_NAME, "Patient and clear"),
          profiles: { full_name: "Chemistry Chen", avatar_url: null },
        },
        tutorRow(BY_HEADLINE, "Chemistry made simple"),
        tutorRow(BY_SUBJECT, "Patient and clear"),
        // In France, and its HEADLINE is what matches "History" — which is
        // exactly the shape the country filter used to be bypassed by.
        {
          ...tutorRow(ELSEWHERE, "History made simple"),
          profiles: { full_name: "Nobody", avatar_url: null },
        },
      ],
      profiles: [
        {
          id: BY_NAME,
          role: "tutor",
          status: "active",
          full_name: "Chemistry Chen",
          country: "GB",
        },
        { id: BY_HEADLINE, role: "tutor", status: "active", full_name: "Hana H", country: "GB" },
        { id: BY_SUBJECT, role: "tutor", status: "active", full_name: "Sam S", country: "GB" },
        { id: ELSEWHERE, role: "tutor", status: "active", full_name: "Nobody", country: "FR" },
      ],
      subjects: [
        { id: 1, name: "Chemistry", slug: "chemistry", category: "science" },
        { id: 2, name: "History", slug: "history", category: "humanities" },
      ],
      tutor_subjects: [
        { tutor_id: BY_SUBJECT, subject_id: 1 },
        { tutor_id: ELSEWHERE, subject_id: 2 },
      ],
    });
  }

  it("finds a tutor by the subject they teach", async () => {
    seedMarket();

    const { tutors } = await searchTutors({ q: "Chemistry" });

    expect(tutors.map((t) => t.id)).toContain(BY_SUBJECT);
  });

  it("still finds them by name and by headline", async () => {
    // The addition must not cost what already worked.
    seedMarket();

    const { tutors } = await searchTutors({ q: "Chemistry" });
    const ids = tutors.map((t) => t.id);

    expect(ids).toContain(BY_NAME);
    expect(ids).toContain(BY_HEADLINE);
  });

  it("does not return someone who matches nothing", async () => {
    seedMarket();

    const { tutors } = await searchTutors({ q: "Chemistry" });

    expect(tutors.map((t) => t.id)).not.toContain(ELSEWHERE);
  });

  it("keeps the country filter binding on a text match", async () => {
    // The headline union used to be added to the matched set AFTER the
    // country filter had been applied, so a country search plus a word that
    // matched a headline returned tutors from everywhere.
    seedMarket();

    const { tutors } = await searchTutors({ q: "History", country: "GB" });

    expect(tutors.map((t) => t.id)).not.toContain(ELSEWHERE);
  });

  it("returns nothing for a word that matches nothing", async () => {
    seedMarket();

    const { tutors, total } = await searchTutors({ q: "Astrophysics" });

    expect(tutors).toHaveLength(0);
    expect(total).toBe(0);
  });
});
