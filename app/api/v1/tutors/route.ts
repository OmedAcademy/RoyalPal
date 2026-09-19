import { handle, requireApiUser, apiOk } from "@/lib/api/handler";
import { searchTutors } from "@/lib/supabase/tutor-search";
import { getFavoriteTutorIds } from "@/lib/supabase/favorites";

export const dynamic = "force-dynamic";

const numberOrUndefined = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Paginated tutor search — the same function the web listing renders from. */
export async function GET(request: Request) {
  return handle("GET /api/v1/tutors", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    const url = new URL(request.url);
    const [results, favoriteIds] = await Promise.all([
      searchTutors({
        subjectId: numberOrUndefined(url.searchParams.get("subjectId")),
        language: url.searchParams.get("language") ?? undefined,
        maxPrice: numberOrUndefined(url.searchParams.get("maxPrice")),
        country: url.searchParams.get("country") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        page: numberOrUndefined(url.searchParams.get("page")),
        pageSize: numberOrUndefined(url.searchParams.get("pageSize")),
      }),
      getFavoriteTutorIds(),
    ]);

    return apiOk({
      ...results,
      tutors: results.tutors.map((tutor) => ({
        ...tutor,
        favorited: favoriteIds.has(tutor.id),
      })),
    });
  });
}
