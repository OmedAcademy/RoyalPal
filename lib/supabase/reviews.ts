import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Review } from "@/types/database";

export type ReviewWithAuthor = Review & {
  author_name: string;
  author_avatar_url: string | null;
};

export const REVIEWS_PAGE_SIZE = 20;
const MAX_REVIEWS_PAGE_SIZE = 50;

export type ReviewPage = {
  reviews: ReviewWithAuthor[];
  page: number;
  pageSize: number;
  /** Every review the caller may see, not just this page. */
  total: number;
  hasMore: boolean;
};

/**
 * A tutor's headline rating.
 *
 * Read from tutor_profiles rather than computed from whatever reviews are on
 * screen. The Reviews screen used to average the first page and print it as
 * the tutor's average, which both contradicted the number on their own public
 * profile and moved every time a review was added past the twentieth.
 *
 * The trigger behind these columns (0035) excludes hidden reviews, which is
 * the same set the tutor can see — so the number and the list agree.
 */
export type TutorRatingSummary = { average: number | null; total: number };

export async function getTutorRatingSummary(tutorId: string): Promise<TutorRatingSummary> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tutor_profiles")
    .select("avg_rating, total_reviews")
    .eq("id", tutorId)
    .maybeSingle();

  return { average: data?.avg_rating ?? null, total: data?.total_reviews ?? 0 };
}

/**
 * Reviews for a tutor's public profile, newest first, with author display
 * info resolved through the review_authors view (see migration 0019 — the
 * view exists because profiles RLS hides students from each other, and
 * only name + avatar should be public, never the whole row).
 */
export async function getTutorReviews(
  tutorId: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<ReviewPage> {
  const supabase = await createClient();

  const pageSize = Math.min(Math.max(opts.pageSize ?? REVIEWS_PAGE_SIZE, 1), MAX_REVIEWS_PAGE_SIZE);
  const page = Math.max(opts.page ?? 0, 0);
  const from = page * pageSize;

  // Hidden reviews are excluded by RLS itself (migration 0035), not by a
  // filter here — so a moderated review cannot reappear because someone
  // forgot a WHERE clause on a new query.
  const {
    data: reviews,
    error,
    count,
  } = await supabase
    .from("reviews")
    .select("*", { count: "exact" })
    .eq("tutor_id", tutorId)
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw error;

  const total = count ?? reviews?.length ?? 0;
  const empty: ReviewPage = { reviews: [], page, pageSize, total, hasMore: false };
  if (!reviews || reviews.length === 0) return empty;

  const authorIds = [...new Set(reviews.map((r) => r.student_id))];
  const { data: authors } = await supabase.from("review_authors").select("*").in("id", authorIds);

  const authorsById = new Map((authors ?? []).map((a) => [a.id, a]));

  return {
    reviews: reviews.map((review) => {
      const author = authorsById.get(review.student_id);
      return {
        ...review,
        author_name: author?.full_name ?? "A student",
        author_avatar_url: author?.avatar_url ?? null,
      };
    }),
    page,
    pageSize,
    total,
    hasMore: from + reviews.length < total,
  };
}

/**
 * Every review about the signed-in tutor, for their own Reviews screen.
 *
 * Deliberately the same RLS-scoped read as the public list, which means a
 * review hidden by moderation is invisible here too. That is the decision
 * taken in migration 0035: the usual reason for hiding a review is that the
 * exchange needs to stop, and handing the tutor a copy would restart it.
 */
export async function getMyTutorReviews(
  tutorId: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<ReviewPage> {
  return getTutorReviews(tutorId, opts);
}
