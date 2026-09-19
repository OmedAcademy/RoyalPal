import { handle, requireApiUser, invokeAction, actionResponse } from "@/lib/api/handler";
import { registerDevice, removeDevice } from "@/lib/actions/account";

export const dynamic = "force-dynamic";

/**
 * Registers this device for push. Called after the OS grants permission, and
 * again on every cold start so last_seen_at stays honest and a token
 * reassigned to another account is re-claimed promptly.
 */
export async function POST(request: Request) {
  return handle("POST /api/v1/devices", async () => {
    const auth = await requireApiUser({ allowSuspended: true });
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as {
      token?: string;
      platform?: string;
      deviceName?: string;
    };

    const result = await invokeAction(
      registerDevice,
      { token: body.token, platform: body.platform, deviceName: body.deviceName },
      {},
    );
    if ("redirectTo" in result) return actionResponse({});
    return actionResponse(result.state);
  });
}

/** Called on sign-out, so the next person to use the phone gets nothing of yours. */
export async function DELETE(request: Request) {
  return handle("DELETE /api/v1/devices", async () => {
    const auth = await requireApiUser({ allowSuspended: true });
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as { token?: string };
    const result = await invokeAction(removeDevice, { token: body.token }, {});
    if ("redirectTo" in result) return actionResponse({});
    return actionResponse(result.state);
  });
}
