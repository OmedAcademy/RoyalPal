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

const { getTutorById } = await import("@/lib/supabase/tutor-search");

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
