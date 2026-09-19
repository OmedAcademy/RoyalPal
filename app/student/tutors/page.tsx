import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { searchTutors } from "@/lib/supabase/tutor-search";
import { TutorFilters } from "@/components/tutor/TutorFilters";
import { TutorCard } from "@/components/tutor/TutorCard";
import { SearchPagination } from "@/components/tutor/SearchPagination";
import { getFavoriteTutorIds } from "@/lib/supabase/favorites";
import type { Subject } from "@/types/database";

export default async function FindTutorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    subject?: string;
    language?: string;
    maxPrice?: string;
    country?: string;
    q?: string;
    page?: string;
  }>;
}) {
  await requireProfile(["student"]);
  const params = await searchParams;
  const supabase = await createClient();

  const subjectId = params.subject ? Number(params.subject) : undefined;
  const maxPrice = params.maxPrice ? Number(params.maxPrice) : undefined;
  const parsedPage = Number(params.page ?? "0");
  const pageIndex = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 0;

  const [{ data: subjects }, results, favoriteIds] = await Promise.all([
    supabase.from("subjects").select("*").order("category").order("name"),
    searchTutors({
      subjectId: subjectId && Number.isFinite(subjectId) ? subjectId : undefined,
      language: params.language || undefined,
      maxPrice: maxPrice && Number.isFinite(maxPrice) ? maxPrice : undefined,
      country: params.country || undefined,
      q: params.q || undefined,
      page: pageIndex,
    }),
    // One query for the whole page rather than one per card: the alternative
    // turns a full page of results into that many extra round trips.
    getFavoriteTutorIds(),
  ]);

  const subjectsById = new Map<number, Subject>((subjects ?? []).map((s) => [s.id, s]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Find a tutor</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Browse approved tutors, check their availability, and book a lesson.
        </p>
      </div>

      <TutorFilters
        subjects={subjects ?? []}
        defaultSubjectId={params.subject ?? ""}
        defaultLanguage={params.language ?? ""}
        defaultMaxPrice={params.maxPrice ?? ""}
      />

      {results.tutors.length === 0 ? (
        <div className="border-hairline bg-surface flex flex-col gap-2 rounded-2xl border p-6">
          <p className="font-medium">No tutors match those filters.</p>
          <p className="text-muted text-sm">
            Try removing a filter, widening the price, or searching a different subject.
          </p>
        </div>
      ) : (
        <>
          <p className="text-muted text-sm" role="status">
            Showing {results.page * results.pageSize + 1}–
            {results.page * results.pageSize + results.tutors.length} of {results.total}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.tutors.map((tutor) => (
              <TutorCard
                key={tutor.id}
                tutor={tutor}
                subjectsById={subjectsById}
                favorited={favoriteIds.has(tutor.id)}
              />
            ))}
          </div>
          <SearchPagination
            page={results.page}
            hasMore={results.hasMore}
            total={results.total}
            pageSize={results.pageSize}
          />
        </>
      )}
    </div>
  );
}
