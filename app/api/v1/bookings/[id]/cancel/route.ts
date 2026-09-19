import { handle, requireApiUser, invokeAction, actionResponse } from "@/lib/api/handler";
import { cancelBooking } from "@/lib/actions/booking";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("POST /api/v1/bookings/[id]/cancel", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: string };

    // Ownership, the cancellation policy, the refund request and the
    // notification all happen inside the action — the same code path the web
    // Cancel button uses, so the two cannot decide different refunds.
    const result = await invokeAction(cancelBooking, { bookingId: id, reason: body.reason }, {});
    if ("redirectTo" in result) return actionResponse({});
    return actionResponse(result.state);
  });
}
