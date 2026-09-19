import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * The caller's saved tutor ids, as a Set for O(1) lookup while rendering a
 * list. One query per page rather than one per card — the alternative is the
 * N+1 that turns a 60-result search into 61 round trips.
 *
 * Returns an empty set for a signed-out caller rather than throwing: the
 * public-facing surfaces render the same markup either way, just without a
 * filled heart.
 */
export async function getFavoriteTutorIds(): Promise<Set<string>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Set();

  const { data } = await supabase.from("favorites").select("tutor_id").eq("student_id", user.id);
  return new Set((data ?? []).map((row) => row.tutor_id));
}

export async function isFavorited(tutorId: string): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from("favorites")
    .select("tutor_id")
    .eq("student_id", user.id)
    .eq("tutor_id", tutorId)
    .maybeSingle();
  return Boolean(data);
}
