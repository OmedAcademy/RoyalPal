import { handle, requireApiUser, apiOk, invokeAction, actionResponse } from "@/lib/api/handler";
import { getFavoriteTutorIds } from "@/lib/supabase/favorites";
import { getTutorsByIds } from "@/lib/supabase/tutor-search";
import { toggleFavorite } from "@/lib/actions/favorites";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle("GET /api/v1/favorites", async () => {
    const auth = await requireApiUser({ roles: ["student"] });
    if ("response" in auth) return auth.response;

    const ids = await getFavoriteTutorIds();
    const tutors = await getTutorsByIds([...ids]);
    return apiOk({ tutors, total: ids.size });
  });
}

export async function POST(request: Request) {
  return handle("POST /api/v1/favorites", async () => {
    const auth = await requireApiUser({ roles: ["student"] });
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as { tutorId?: string };
    const result = await invokeAction(toggleFavorite, { tutorId: body.tutorId }, {});
    if ("redirectTo" in result) return actionResponse({});
    if (result.state.error) return actionResponse(result.state);
    return apiOk({ ok: true, favorited: result.state.favorited ?? false });
  });
}
