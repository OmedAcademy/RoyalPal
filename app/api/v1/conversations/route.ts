import { handle, requireApiUser, apiOk } from "@/lib/api/handler";
import { listConversations } from "@/lib/messaging/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle("GET /api/v1/conversations", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    // Paged rather than capped, so a client that keeps asking eventually sees
    // every thread instead of stopping at an invisible ceiling.
    const page = Number(new URL(request.url).searchParams.get("page") ?? "0");
    const result = await listConversations(auth.profile.id, {
      page: Number.isFinite(page) ? page : 0,
    });

    return apiOk({ ...result, timezone: auth.profile.timezone });
  });
}
