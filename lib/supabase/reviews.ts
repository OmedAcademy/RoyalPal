import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Review } from "@/types/database";

export type ReviewWithAuthor = Review & {
  author_name: string;
  author_avatar_url: string | null;
};

const REVIEWS_PAGE_SIZE = 20;

/**
 * Reviews for a tutor's public profile, newest first, with author display
 * info resolved through the review_authors view (see migration 0019 — the
 * view exists because profiles RLS hides students from each other, and
 * only name + avatar should be public, never the whole row).
 */
export async function getTutorReviews(tutorId: string): Promise<ReviewWithAuthor[]> {
  const supabase = await createClient();

  // Hidden reviews are excluded by RLS itself (migration 0035), not by a
  // filter here — so a moderated review cannot reappear because someone
  // forgot a WHERE clause on a new query.
  const { data: reviews, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("tutor_id", tutorId)
    .order("created_at", { ascending: false })
    .limit(REVIEWS_PAGE_SIZE);

  if (error) throw error;
  if (!reviews || reviews.length === 0) return [];

  const authorIds = [...new Set(reviews.map((r) => r.student_id))];
  const { data: authors } = await supabase.from("review_authors").select("*").in("id", authorIds);

  const authorsById = new Map((authors ?? []).map((a) => [a.id, a]));

  return reviews.map((review) => {
    const author = authorsById.get(review.student_id);
    return {
      ...review,
      author_name: author?.full_name ?? "A student",
      author_avatar_url: author?.avatar_url ?? null,
    };
  });
}

/**
 * Every review about the signed-in tutor, for their own Reviews screen.
 *
 * Deliberately the same RLS-scoped read as the public list, which means a
 * review hidden by moderation is invisible here too. That is the decision
 * taken in migration 0035: the usual reason for hiding a review is that the
 * exchange needs to stop, and handing the tutor a copy would restart it.
 */
export async function getMyTutorReviews(tutorId: string): Promise<ReviewWithAuthor[]> {
  return getTutorReviews(tutorId);
}
