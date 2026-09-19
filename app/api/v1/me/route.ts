import { handle, requireApiUser, apiOk } from "@/lib/api/handler";
import { createClient } from "@/lib/supabase/server";
import { unreadMessageCount } from "@/lib/messaging/service";
import { NotificationService } from "@/lib/notifications/service";
import { TUTOR_PROFILE_CLIENT_COLUMNS } from "@/lib/supabase/columns";

export const dynamic = "force-dynamic";

/**
 * Everything the app needs on launch, in one round trip: who you are, which
 * profile you have, and the two badge counts. A cold start on a phone is the
 * worst place to discover you need four requests before you can render.
 */
export async function GET() {
  return handle("GET /api/v1/me", async () => {
    const auth = await requireApiUser({ allowSuspended: true });
    if ("response" in auth) return auth.response;

    const supabase = await createClient();
    const [roleProfile, unreadMessages, unreadNotifications] = await Promise.all([
      auth.profile.role === "tutor"
        ? supabase
            .from("tutor_profiles")
            .select(TUTOR_PROFILE_CLIENT_COLUMNS)
            .eq("id", auth.profile.id)
            .maybeSingle()
        : supabase.from("student_profiles").select("*").eq("id", auth.profile.id).maybeSingle(),
      unreadMessageCount(auth.profile.id),
      NotificationService.unreadCount(),
    ]);

    return apiOk({
      profile: {
        id: auth.profile.id,
        role: auth.profile.role,
        fullName: auth.profile.full_name,
        avatarUrl: auth.profile.avatar_url,
        country: auth.profile.country,
        timezone: auth.profile.timezone,
        status: auth.profile.status,
        deletionRequestedAt: auth.profile.deletion_requested_at,
      },
      roleProfile: roleProfile.data ?? null,
      badges: { unreadMessages, unreadNotifications },
    });
  });
}
