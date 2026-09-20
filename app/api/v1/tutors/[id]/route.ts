import { handle, requireApiUser, apiOk, apiError } from "@/lib/api/handler";
import { getTutorById } from "@/lib/supabase/tutor-search";
import { getTutorReviews } from "@/lib/supabase/reviews";
import { isFavorited } from "@/lib/supabase/favorites";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("GET /api/v1/tutors/[id]", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const tutor = await getTutorById(id);
    // getTutorById already filters to approved tutors, so an unapproved one is
    // a 404 here exactly as it is a 404 on the web.
    if (!tutor) return apiError("Tutor not found", 404, "not_found");

    const supabase = await createClient();
    const [{ data: subjects }, reviews, favorited] = await Promise.all([
      tutor.subject_ids.length
        ? supabase.from("subjects").select("*").in("id", tutor.subject_ids)
        : Promise.resolve({ data: [] }),
      getTutorReviews(id),
      isFavorited(id),
    ]);

    // `reviews` keeps its shape for existing clients; the total is what makes
    // "20 of 137" sayable instead of implying 20 is all there is.
    return apiOk({
      tutor,
      subjects: subjects ?? [],
      reviews: reviews.reviews,
      reviewsTotal: reviews.total,
      favorited,
    });
  });
}
