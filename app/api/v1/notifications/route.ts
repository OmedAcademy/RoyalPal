import { handle, requireApiUser, apiOk } from "@/lib/api/handler";
import { NotificationService } from "@/lib/notifications/service";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle("GET /api/v1/notifications", async () => {
    const auth = await requireApiUser({ allowSuspended: true });
    if ("response" in auth) return auth.response;

    const [notifications, unreadCount] = await Promise.all([
      NotificationService.list(50),
      NotificationService.unreadCount(),
    ]);
    return apiOk({ notifications, unreadCount });
  });
}

/** Marks one notification read, or all of them when no id is given. */
export async function POST(request: Request) {
  return handle("POST /api/v1/notifications", async () => {
    const auth = await requireApiUser({ allowSuspended: true });
    if ("response" in auth) return auth.response;

    const body = (await request.json().catch(() => ({}))) as { id?: string };
    if (body.id) await NotificationService.markAsRead(body.id);
    else await NotificationService.markAllAsRead();

    return apiOk({ ok: true, unreadCount: await NotificationService.unreadCount() });
  });
}
