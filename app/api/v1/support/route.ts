import { handle, requireApiUser, apiOk, invokeAction, actionResponse } from "@/lib/api/handler";
import { listMyTickets } from "@/lib/support/service";
import { createTicket } from "@/lib/actions/support";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle("GET /api/v1/support", async () => {
    // Suspended accounts reach support here for the same reason they reach it
    // on the web: appealing a suspension is the one thing they need to do.
    const auth = await requireApiUser({ allowSuspended: true });
    if ("response" in auth) return auth.response;

    return apiOk({ tickets: await listMyTickets() });
  });
}

export async function POST(request: Request) {
  return handle("POST /api/v1/support", async () => {
    const auth = await requireApiUser({ allowSuspended: true });
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as {
      category?: string;
      subject?: string;
      body?: string;
    };

    const result = await invokeAction(
      createTicket,
      { category: body.category, subject: body.subject, body: body.body },
      {},
    );
    // createTicket redirects to the new ticket on success; the path carries
    // its id, which is what the app needs to navigate.
    if ("redirectTo" in result) {
      return apiOk({ ok: true, ticketId: result.redirectTo.split("/").pop() ?? null }, 201);
    }
    return actionResponse(result.state);
  });
}
