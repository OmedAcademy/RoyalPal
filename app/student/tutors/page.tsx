import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { searchTutors } from "@/lib/supabase/tutor-search";
import { TutorFilters } from "@/components/tutor/TutorFilters";
import { TutorCard } from "@/components/tutor/TutorCard";
import { getFavoriteTutorIds } from "@/lib/supabase/favorites";
import type { Subject } from "@/types/database";

export default async function FindTutorsPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; language?: string; maxPrice?: string }>;
}) {
  await requireProfile(["student"]);
  const params = await searchParams;
  const supabase = await createClient();

  const subjectId = params.subject ? Number(params.subject) : undefined;
  const maxPrice = params.maxPrice ? Number(params.maxPrice) : undefined;

  const [{ data: subjects }, tutors, favoriteIds] = await Promise.all([
    supabase.from("subjects").select("*").order("category").order("name"),
    searchTutors({
      subjectId: subjectId && Number.isFinite(subjectId) ? subjectId : undefined,
      language: params.language || undefined,
      maxPrice: maxPrice && Number.isFinite(maxPrice) ? maxPrice : undefined,
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

      {tutors.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No tutors match those filters yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tutors.map((tutor) => (
            <TutorCard
              key={tutor.id}
              tutor={tutor}
              subjectsById={subjectsById}
              favorited={favoriteIds.has(tutor.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
