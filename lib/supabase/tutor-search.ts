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
  /** ISO 3166 alpha-2, matched against the tutor's own profile country. */
  country?: string;
  /** Free text, matched against name and headline. */
  q?: string;
  /** Rows per page. Bounded so a caller cannot ask for the whole table. */
  pageSize?: number;
  /** Zero-based page index. */
  page?: number;
};

export type TutorSearchPage = {
  tutors: TutorSearchResult[];
  page: number;
  pageSize: number;
  /** Total matching rows, so a UI can show "1-20 of 137" and a last page. */
  total: number;
  hasMore: boolean;
};

/**
 * Page size when a caller does not say. The old behaviour was a hard cap of 60
 * rows with no way past it — which is not a safety limit, it is a silent
 * truncation: the 61st tutor to join became invisible to search with nothing
 * anywhere saying so. A bounded page plus a total and a cursor is the version
 * that stays safe AND stays honest as the tutor base grows.
 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

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
export async function searchTutors(filters: TutorSearchFilters): Promise<TutorSearchPage> {
  const supabase = await createClient();

  const pageSize = Math.min(Math.max(filters.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(filters.page ?? 0, 0);
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const empty: TutorSearchPage = { tutors: [], page, pageSize, total: 0, hasMore: false };

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
    if (tutorIds.length === 0) return empty;
  }

  // Country and free-text name live on `profiles`, not `tutor_profiles`, so
  // they are resolved to an id set first and intersected. Doing it this way
  // rather than filtering on the embedded profiles row avoids PostgREST
  // returning a tutor with a null embed instead of excluding them.
  if (filters.country || filters.q) {
    let profileQuery = supabase.from("profiles").select("id").eq("role", "tutor");
    if (filters.country) profileQuery = profileQuery.eq("country", filters.country);
    if (filters.q) profileQuery = profileQuery.ilike("full_name", `%${escapeLike(filters.q)}%`);

    const { data: profileMatches, error } = await profileQuery.limit(1000);
    if (error) throw error;

    const matchedIds = new Set((profileMatches ?? []).map((row) => row.id));

    // A free-text query should also match a headline, which lives on
    // tutor_profiles — so the two id sets are unioned rather than intersected.
    if (filters.q) {
      const { data: headlineMatches } = await supabase
        .from("tutor_profiles")
        .select("id")
        .ilike("headline", `%${escapeLike(filters.q)}%`)
        .limit(1000);
      for (const row of headlineMatches ?? []) matchedIds.add(row.id);
    }

    tutorIds = tutorIds ? tutorIds.filter((id) => matchedIds.has(id)) : [...matchedIds];
    if (tutorIds.length === 0) return empty;
  }

  let query = supabase
    .from("tutor_profiles")
    .select(TUTOR_SELECT, { count: "exact" })
    .eq("verification_status", "approved")
    .order("avg_rating", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (tutorIds) {
    query = query.in("id", tutorIds);
  }
  if (filters.language) {
    query = query.contains("teaching_languages", [filters.language]);
  }
  if (filters.maxPrice) {
    query = query.lte("hourly_rate_cents", Math.round(filters.maxPrice * 100));
  }

  const { data, error, count } = await query.returns<RawTutorRow[]>();
  if (error) throw error;

  const total = count ?? 0;
  return {
    tutors: (data ?? []).map(normalizeTutorRow),
    page,
    pageSize,
    total,
    hasMore: from + (data?.length ?? 0) < total,
  };
}

/**
 * Escapes the wildcards PostgREST's ilike treats as special.
 *
 * Without this a search for "100%" matches every tutor, and a search for "_"
 * matches all of them too — not a security hole, since the value is still
 * parameterised, but a search box that silently ignores what was typed.
 */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (match) => `\\${match}`).slice(0, 100);
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
