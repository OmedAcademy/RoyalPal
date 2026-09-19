import { handle, requireApiUser, invokeAction, actionResponse } from "@/lib/api/handler";
import { createReview } from "@/lib/actions/review";

export const dynamic = "force-dynamic";

/**
 * Leaves a review. Eligibility — a completed lesson, that the caller was the
 * student on, that was actually paid for, and only once — is enforced by RLS
 * and a unique constraint (migrations 0008 and 0029), not here. This route is
 * the transport.
 */
export async function POST(request: Request) {
  return handle("POST /api/v1/reviews", async () => {
    const auth = await requireApiUser({ roles: ["student"] });
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as {
      bookingId?: string;
      rating?: number;
      comment?: string;
    };

    const result = await invokeAction(
      createReview,
      { bookingId: body.bookingId, rating: body.rating, comment: body.comment },
      {},
    );
    if ("redirectTo" in result) return actionResponse({});
    return actionResponse(result.state);
  });
}
