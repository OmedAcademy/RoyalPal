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
