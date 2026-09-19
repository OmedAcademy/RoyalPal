import { handle, requireApiUser, apiOk } from "@/lib/api/handler";
import { listConversations } from "@/lib/messaging/service";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle("GET /api/v1/conversations", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    const conversations = await listConversations(auth.profile.id);
    return apiOk({ conversations, timezone: auth.profile.timezone });
  });
}
