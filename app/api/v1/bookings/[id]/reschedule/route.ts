import { handle, requireApiUser, invokeAction, actionResponse } from "@/lib/api/handler";
import { rescheduleBooking } from "@/lib/actions/booking";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("POST /api/v1/bookings/[id]/reschedule", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const body = (await request.json()) as { startAt?: string; reason?: string };

    const result = await invokeAction(
      rescheduleBooking,
      { bookingId: id, startAt: body.startAt, reason: body.reason },
      {},
    );
    if ("redirectTo" in result) return actionResponse({});
    return actionResponse(result.state);
  });
}
