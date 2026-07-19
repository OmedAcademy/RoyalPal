import "server-only";
import { createClient } from "@/lib/supabase/server";

export type TutorSearchResult = {
  id: string;
  headline: string;
  bio: string;
  hourly_rate_cents: number;
  trial_price_cents: number | null;
  currency: string;
  teaching_languages: string[];
  specializations: string[];
  avg_rating: number | null;
  total_reviews: number;
  video_url: string | null;
  full_name: string;
  avatar_url: string | null;
  subject_ids: number[];
};

export type TutorSearchFilters = {
  subjectId?: number;
  language?: string;
  maxPrice?: number;
};

type RawTutorRow = {
  id: string;
  headline: string;
  bio: string;
  hourly_rate_cents: number;
  trial_price_cents: number | null;
  currency: string;
  teaching_languages: string[];
  specializations: string[];
  avg_rating: number | null;
  total_reviews: number;
  video_url: string | null;
  profiles: { full_name: string; avatar_url: string | null } | null;
  tutor_subjects: { subject_id: number }[] | null;
};

// `profiles!tutor_profiles_id_fkey` disambiguates: PostgREST also sees an
// indirect tutor_profiles -> favorites -> profiles path and refuses to
// embed without an explicit FK name.
const TUTOR_SELECT =
  "id, headline, bio, hourly_rate_cents, trial_price_cents, currency, teaching_languages, specializations, avg_rating, total_reviews, video_url, profiles!tutor_profiles_id_fkey(full_name, avatar_url), tutor_subjects(subject_id)";

function normalizeTutorRow(row: RawTutorRow): TutorSearchResult {
  return {
    id: row.id,
    headline: row.headline,
    bio: row.bio,
    hourly_rate_cents: row.hourly_rate_cents,
    trial_price_cents: row.trial_price_cents,
    currency: row.currency,
    teaching_languages: row.teaching_languages,
    specializations: row.specializations,
    avg_rating: row.avg_rating,
    total_reviews: row.total_reviews,
    video_url: row.video_url,
    full_name: row.profiles?.full_name ?? "Tutor",
    avatar_url: row.profiles?.avatar_url ?? null,
    subject_ids: (row.tutor_subjects ?? []).map((s) => s.subject_id),
  };
}

/** Approved tutors only, matching tutor_profiles' public-visibility RLS
 * policy — search results and the anon-blocked profile join both depend on
 * verification_status = 'approved'. */
export async function searchTutors(filters: TutorSearchFilters): Promise<TutorSearchResult[]> {
  const supabase = await createClient();

  // Filtering by subject via a resolved id list, rather than an embedded
  // `tutor_subjects!inner` filter, avoids relying on PostgREST's
  // top-row-filtering semantics for embedded resources.
  let tutorIds: string[] | null = null;
  if (filters.subjectId) {
    const { data: matches, error } = await supabase
      .from("tutor_subjects")
      .select("tutor_id")
      .eq("subject_id", filters.subjectId);

    if (error) throw error;

    tutorIds = (matches ?? []).map((m) => m.tutor_id);
    if (tutorIds.length === 0) return [];
  }

  let query = supabase
    .from("tutor_profiles")
    .select(TUTOR_SELECT)
    .eq("verification_status", "approved")
    .order("avg_rating", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (tutorIds) {
    query = query.in("id", tutorIds);
  }
  if (filters.language) {
    query = query.contains("teaching_languages", [filters.language]);
  }
  if (filters.maxPrice) {
    query = query.lte("hourly_rate_cents", Math.round(filters.maxPrice * 100));
  }

  const { data, error } = await query.returns<RawTutorRow[]>();
  if (error) throw error;

  return (data ?? []).map(normalizeTutorRow);
}

export async function getTutorById(id: string): Promise<TutorSearchResult | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tutor_profiles")
    .select(TUTOR_SELECT)
    .eq("id", id)
    .eq("verification_status", "approved")
    .maybeSingle()
    .returns<RawTutorRow | null>();

  if (error) throw error;
  if (!data) return null;

  return normalizeTutorRow(data);
}
