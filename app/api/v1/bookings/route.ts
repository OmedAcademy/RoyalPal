import { handle, requireApiUser, apiOk, invokeAction, actionResponse } from "@/lib/api/handler";
import { getBookingsFor } from "@/lib/supabase/bookings";
import { createBooking } from "@/lib/actions/booking";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle("GET /api/v1/bookings", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    const role = auth.profile.role === "tutor" ? "tutor" : "student";
    const bookings = await getBookingsFor(auth.profile.id, role);
    return apiOk({ bookings, timezone: auth.profile.timezone });
  });
}

/**
 * Creates a booking and hands back the Stripe Checkout URL.
 *
 * The action redirects on success, which is how the web flow reaches Stripe.
 * invokeAction catches that and returns the destination so the app can open it
 * in a browser — the payment sheet has to be a real browser session, not an
 * in-app webview, for Stripe's own fraud signals and for 3-D Secure to work.
 */
export async function POST(request: Request) {
  return handle("POST /api/v1/bookings", async () => {
    const auth = await requireApiUser({ roles: ["student"] });
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as Record<string, string | number>;
    const result = await invokeAction(
      createBooking,
      {
        tutorId: body.tutorId,
        subjectId: body.subjectId,
        startAt: body.startAt,
        durationMinutes: body.durationMinutes,
        lessonType: body.lessonType,
      },
      {},
    );

    if ("redirectTo" in result) {
      return apiOk({ ok: true, checkoutUrl: result.redirectTo }, 201);
    }
    return actionResponse(result.state);
  });
}
