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
  /** Whether this tutor can currently accept a PAID booking (Stripe
   * Connect onboarding complete and verified). Trial/free bookings are
   * unaffected — see the gate in lib/actions/booking.ts. */
  stripe_charges_enabled: boolean;
};

export type TutorSearchFilters = {
  subjectId?: number;
  language?: string;
  maxPrice?: number;
  /** Hard cap on rows returned. Always bounded so a growing tutor base can
   * never turn a listing into an unbounded scan. */
  limit?: number;
};

/** Safety ceiling applied when a caller doesn't specify one. */
const DEFAULT_SEARCH_LIMIT = 60;

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
  stripe_charges_enabled: boolean;
  profiles: { full_name: string; avatar_url: string | null } | null;
  tutor_subjects: { subject_id: number }[] | null;
};

// `profiles!tutor_profiles_id_fkey` disambiguates: PostgREST also sees an
// indirect tutor_profiles -> favorites -> profiles path and refuses to
// embed without an explicit FK name.
const TUTOR_SELECT =
  "id, headline, bio, hourly_rate_cents, trial_price_cents, currency, teaching_languages, specializations, avg_rating, total_reviews, video_url, stripe_charges_enabled, profiles!tutor_profiles_id_fkey(full_name, avatar_url), tutor_subjects(subject_id)";

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
    stripe_charges_enabled: row.stripe_charges_enabled,
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
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? DEFAULT_SEARCH_LIMIT);

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

/** Loads specific approved tutors by id (order not guaranteed). Used by the
 * student dashboard's favourites list. Respects the same approved-only
 * visibility as search. */
export async function getTutorsByIds(ids: string[]): Promise<TutorSearchResult[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tutor_profiles")
    .select(TUTOR_SELECT)
    .eq("verification_status", "approved")
    .in("id", ids)
    .returns<RawTutorRow[]>();

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
