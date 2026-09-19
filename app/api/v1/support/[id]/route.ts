import {
  handle,
  requireApiUser,
  apiOk,
  apiError,
  invokeAction,
  actionResponse,
} from "@/lib/api/handler";
import { getTicket } from "@/lib/support/service";
import { replyToTicket } from "@/lib/actions/support";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("GET /api/v1/support/[id]", async () => {
    // Suspended accounts read their own tickets for the same reason they can
    // open one: the appeal is the point.
    const auth = await requireApiUser({ allowSuspended: true });
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const result = await getTicket(id);
    if (!result) return apiError("Request not found", 404, "not_found");

    return apiOk(result);
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("POST /api/v1/support/[id]", async () => {
    const auth = await requireApiUser({ allowSuspended: true });
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const body = (await request.json()) as { body?: string };

    const result = await invokeAction(replyToTicket, { ticketId: id, body: body.body }, {});
    if ("redirectTo" in result) return actionResponse({});
    return actionResponse(result.state);
  });
}
