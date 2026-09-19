import { requireProfile, requireProfileAllowingSuspended } from "@/lib/supabase/queries";
import { NotificationService } from "@/lib/notifications/service";
import { unreadMessageCount } from "@/lib/messaging/service";
import { navigationFor } from "@/lib/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { SignOutButton } from "@/components/auth/SignOutButton";
import type { UserRole } from "@/types/database";

/**
 * The server half of the authenticated shell: resolves who the viewer is,
 * loads the two badge counts, and hands the result to the client AppShell.
 *
 * Split this way because AppShell needs usePathname (client) while the
 * profile, notifications and unread counts all need the request-scoped
 * Supabase client (server). Every authenticated area renders this, so the
 * navigation is identical whichever route a person is standing on.
 */
export async function MemberShell({
  allowedRoles,
  areaLabel,
  allowSuspended = false,
  children,
}: {
  allowedRoles: UserRole[];
  areaLabel?: string;
  /** Only /support sets this. See requireProfileAllowingSuspended for why a
   * suspended account must still be able to open that one area. */
  allowSuspended?: boolean;
  children: React.ReactNode;
}) {
  const profile = allowSuspended
    ? await requireProfileAllowingSuspended(allowedRoles)
    : await requireProfile(allowedRoles);

  const [notifications, unreadNotifications, unreadMessages] = await Promise.all([
    NotificationService.list(),
    NotificationService.unreadCount(),
    unreadMessageCount(profile.id),
  ]);

  const label =
    areaLabel ??
    (profile.role === "student" ? "Student" : profile.role === "tutor" ? "Tutor" : "Admin");

  return (
    <AppShell
      areaLabel={label}
      items={navigationFor(profile.role, { unreadMessages })}
      headerRight={
        <>
          <NotificationCenter notifications={notifications} unreadCount={unreadNotifications} />
          <SignOutButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
