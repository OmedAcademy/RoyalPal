import { handle, requireApiUser, invokeAction, actionResponse } from "@/lib/api/handler";
import { sendMessage } from "@/lib/actions/messaging";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("POST /api/v1/conversations/[id]/messages", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const body = (await request.json()) as { body?: string };

    const result = await invokeAction(sendMessage, { conversationId: id, body: body.body }, {});
    if ("redirectTo" in result) return actionResponse({});
    return actionResponse(result.state);
  });
}
