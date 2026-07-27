"use server";

import { NotificationService } from "@/lib/notifications/service";

/**
 * Thin server-action surface over NotificationService for the notification
 * center. Each delegates to the service, which is RLS-scoped to the calling
 * user — a user can only ever mutate their own notifications. The client
 * calls router.refresh() afterward to re-pull counts, so no revalidation is
 * needed here.
 */
export async function markNotificationRead(id: string): Promise<void> {
  await NotificationService.markAsRead(id);
}

export async function markAllNotificationsRead(): Promise<void> {
  await NotificationService.markAllAsRead();
}

// Note: NotificationService.delete() exists as part of the service API but has
// no action wrapper yet — there is no dismiss affordance in the UI, and an
// exported-but-unimported action is dead surface area. Add the wrapper when
// the button ships.
