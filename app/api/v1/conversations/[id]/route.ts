import { handle, requireApiUser, apiOk, apiError } from "@/lib/api/handler";
import { getConversation, markConversationRead } from "@/lib/messaging/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("GET /api/v1/conversations/[id]", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    const { id } = await params;
    // `before` pages backwards through the thread; without it the caller gets
    // the newest page.
    const before = new URL(request.url).searchParams.get("before") ?? undefined;
    const result = await getConversation(id, auth.profile.id, { before });
    // RLS scopes the row, so "not yours" and "does not exist" are the same
    // answer here as they are on the web.
    if (!result) return apiError("Conversation not found", 404, "not_found");

    await markConversationRead(id, auth.profile.id);
    return apiOk({ ...result, timezone: auth.profile.timezone });
  });
}
