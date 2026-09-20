import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";

/**
 * REV-2 — the tutor's own Reviews screen.
 *
 * It averaged the first page of reviews and printed the result as the tutor's
 * average. That contradicted the number on their own public profile, which
 * comes from tutor_profiles, and it moved every time a review landed past the
 * twentieth. And because the list stopped at twenty, reviews 21+ had no reply
 * form at all — the documented right of reply simply was not available on
 * them.
 */

const TUTOR = "22222222-2222-4222-8222-222222222222";

let fake: ReturnType<typeof createFakeSupabase>;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.client }));

const { getTutorReviews, getTutorRatingSummary, REVIEWS_PAGE_SIZE } =
  await import("@/lib/supabase/reviews");

/** `count` reviews, newest first, every one of them five stars. */
function seed(count: number, opts: { avgRating?: number | null; totalReviews?: number } = {}) {
  const base = Date.UTC(2026, 0, 1);
  fake = createFakeSupabase({
    tutor_profiles: [
      {
        id: TUTOR,
        avg_rating: opts.avgRating === undefined ? 4.2 : opts.avgRating,
        total_reviews: opts.totalReviews ?? count,
      },
    ],
    reviews: Array.from({ length: count }, (_, i) => ({
      id: `r${String(i).padStart(4, "0")}`,
      tutor_id: TUTOR,
      student_id: `s${i}`,
      rating: 5,
      comment: `review ${i}`,
      tutor_reply: null,
      created_at: new Date(base + i * 86_400_000).toISOString(),
    })),
    review_authors: [],
  });
}

beforeEach(() => seed(25));

describe("getTutorRatingSummary — the headline number", () => {
  it("is the stored average, not the average of whatever is on screen", async () => {
    // Every seeded review is five stars, so a page average would read 5.0.
    // The tutor's real average is 4.2, because the reviews they are no longer
    // shown still count.
    seed(25, { avgRating: 4.2, totalReviews: 137 });

    const summary = await getTutorRatingSummary(TUTOR);

    expect(summary.average).toBe(4.2);
    expect(summary.total).toBe(137);
  });

  it("reports no average for a tutor with no reviews", async () => {
    seed(0, { avgRating: null, totalReviews: 0 });

    const summary = await getTutorRatingSummary(TUTOR);

    expect(summary.average).toBeNull();
    expect(summary.total).toBe(0);
  });
});

describe("getTutorReviews — reviews past the twentieth", () => {
  it("says how many there are in total, not just how many it returned", async () => {
    const page = await getTutorReviews(TUTOR);

    expect(page.reviews).toHaveLength(REVIEWS_PAGE_SIZE);
    expect(page.total).toBe(25);
    expect(page.hasMore).toBe(true);
  });

  it("returns the rest on the next page, so each one can be replied to", async () => {
    // A review with no reply form is a right of reply that exists only on
    // paper.
    const second = await getTutorReviews(TUTOR, { page: 1 });

    expect(second.reviews).toHaveLength(5);
    expect(second.hasMore).toBe(false);
  });

  it("does not repeat a review across the two pages", async () => {
    const first = await getTutorReviews(TUTOR);
    const second = await getTutorReviews(TUTOR, { page: 1 });

    const ids = new Set(first.reviews.map((r) => r.id));
    expect(second.reviews.some((r) => ids.has(r.id))).toBe(false);
  });

  it("reports no further pages when everything fits on one", async () => {
    seed(3);

    const page = await getTutorReviews(TUTOR);

    expect(page.total).toBe(3);
    expect(page.hasMore).toBe(false);
  });
});
