import { handle, apiOk, apiError, invokeAction } from "@/lib/api/handler";
import { requestPasswordReset } from "@/lib/actions/auth";

export const dynamic = "force-dynamic";

/**
 * Requests a password-reset email.
 *
 * Answers identically whether or not the address has an account, exactly as
 * the web form does — an API that returns 404 for an unknown address is a
 * faster account-enumeration oracle than the form ever was.
 */
export async function POST(request: Request) {
  return handle("POST /api/v1/auth/reset-password", async () => {
    const body = (await request.json().catch(() => null)) as { email?: string } | null;
    if (!body?.email) return apiError("Enter your email address", 400, "bad_request");

    const result = await invokeAction(requestPasswordReset, { email: body.email }, {});
    if ("redirectTo" in result) return apiOk({ ok: true });

    return apiOk({ ok: true, message: result.state.message ?? null });
  });
}
