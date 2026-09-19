import { handle, apiOk, apiError, invokeAction } from "@/lib/api/handler";
import { signup } from "@/lib/actions/auth";

export const dynamic = "force-dynamic";

/**
 * Sign-up for the mobile apps.
 *
 * Delegates to the same Server Action the web form posts to, which means the
 * age gate, the password policy, the consent record and the rate limit are the
 * identical rules — not a second copy that drifts. Re-implementing "is this
 * person 18" in the app would put the check on a device the person controls.
 *
 * Unauthenticated by design: this is how an account comes into existence. The
 * action's own rate limit is what stops it being a signup cannon.
 */
export async function POST(request: Request) {
  return handle("POST /api/v1/auth/sign-up", async () => {
    const body = (await request.json().catch(() => null)) as Record<string, string> | null;
    if (!body) return apiError("Invalid request body", 400, "bad_request");

    const result = await invokeAction(
      signup,
      {
        fullName: body.fullName,
        email: body.email,
        password: body.password,
        dateOfBirth: body.dateOfBirth,
        role: body.role,
        // The web form sends a checkbox value; the app sends the same token so
        // one schema serves both.
        acceptedTerms: body.acceptedTerms ?? "on",
      },
      {},
    );

    // The action redirects only when Supabase returns a session immediately
    // (email confirmation disabled). The app still has to sign in itself to
    // get a session of its own, so both paths tell it the same thing.
    if ("redirectTo" in result) {
      return apiOk({ ok: true, needsConfirmation: false }, 201);
    }
    if (result.state.error) return apiError(result.state.error, 422, "rejected");

    return apiOk({ ok: true, needsConfirmation: true, message: result.state.message ?? null }, 201);
  });
}
