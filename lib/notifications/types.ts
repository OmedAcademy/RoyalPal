/**
 * Notification vocabulary. Types are plain strings in the database so new
 * kinds ship without a migration; this module is the single source of truth
 * that maps each known type to its category and display icon. Unknown types
 * still render (with a sensible fallback), so forward-compatibility never
 * breaks the UI.
 */
export type NotificationType =
  | "booking_created"
  | "booking_confirmed"
  | "booking_cancelled"
  | "payment_succeeded"
  | "payment_failed"
  | "tutor_approved"
  | "tutor_rejected"
  | "payouts_enabled"
  | "review_received"
  | "review_replied"
  | "system_announcement";

export type NotificationCategory = "bookings" | "payments" | "account" | "reviews" | "system";

export type NotificationMeta = { category: NotificationCategory; icon: string };

export const NOTIFICATION_META: Record<NotificationType, NotificationMeta> = {
  booking_created: { category: "bookings", icon: "📅" },
  booking_confirmed: { category: "bookings", icon: "✅" },
  booking_cancelled: { category: "bookings", icon: "🚫" },
  payment_succeeded: { category: "payments", icon: "💳" },
  payment_failed: { category: "payments", icon: "⚠️" },
  tutor_approved: { category: "account", icon: "🎓" },
  tutor_rejected: { category: "account", icon: "📝" },
  payouts_enabled: { category: "account", icon: "💰" },
  review_received: { category: "reviews", icon: "⭐" },
  review_replied: { category: "reviews", icon: "💬" },
  system_announcement: { category: "system", icon: "📢" },
};

export const FALLBACK_META: NotificationMeta = { category: "system", icon: "🔔" };

export function metaFor(type: string): NotificationMeta {
  return NOTIFICATION_META[type as NotificationType] ?? FALLBACK_META;
}

/** Flexible click-through / context payload stored in the `data` jsonb. */
export type NotificationData = {
  href?: string;
  [key: string]: unknown;
};

/** What callers pass to NotificationService.emit(). */
export type NotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: NotificationData;
};

/** Shape returned to the UI (client-safe, no internal columns). */
export type NotificationDTO = {
  id: string;
  type: string;
  icon: string;
  category: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: string;
};
