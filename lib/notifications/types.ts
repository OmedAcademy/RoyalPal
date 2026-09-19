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
  | "payment_refunded"
  | "transfer_reversed"
  | "dispute_created"
  | "dispute_resolved"
  | "tutor_approved"
  | "tutor_rejected"
  | "payouts_enabled"
  | "payouts_action_required"
  | "payout_failed"
  | "review_received"
  | "review_replied"
  | "review_hidden"
  | "message_received"
  | "lesson_reminder"
  | "booking_rescheduled"
  | "support_reply"
  | "account_deletion_requested"
  | "account_deletion_cancelled";

export type NotificationCategory =
  "bookings" | "payments" | "account" | "reviews" | "messages" | "support" | "system";

/**
 * The categories a user may switch off, and the label shown next to each
 * toggle. Everything NOT listed here — password changes, security notices,
 * account suspension — is transactional and never routed through the
 * preference check, so there is no row that could switch it off.
 */
export const OPTIONAL_CATEGORIES: {
  category: NotificationCategory;
  label: string;
  description: string;
}[] = [
  {
    category: "bookings",
    label: "Lessons",
    description: "Confirmations, cancellations, reschedules and reminders.",
  },
  {
    category: "messages",
    label: "Messages",
    description: "When the other person in a lesson sends you a message.",
  },
  {
    category: "reviews",
    label: "Reviews",
    description: "When you receive a review or a reply to one.",
  },
  {
    category: "payments",
    label: "Payments",
    description: "Receipts, refunds and payout activity.",
  },
];

export type NotificationMeta = { category: NotificationCategory; icon: string };

export const NOTIFICATION_META: Record<NotificationType, NotificationMeta> = {
  booking_created: { category: "bookings", icon: "📅" },
  booking_confirmed: { category: "bookings", icon: "✅" },
  booking_cancelled: { category: "bookings", icon: "🚫" },
  payment_succeeded: { category: "payments", icon: "💳" },
  payment_failed: { category: "payments", icon: "⚠️" },
  payment_refunded: { category: "payments", icon: "↩️" },
  transfer_reversed: { category: "payments", icon: "🚨" },
  dispute_created: { category: "payments", icon: "⚖️" },
  dispute_resolved: { category: "payments", icon: "📌" },
  tutor_approved: { category: "account", icon: "🎓" },
  tutor_rejected: { category: "account", icon: "📝" },
  payouts_enabled: { category: "account", icon: "💰" },
  payouts_action_required: { category: "account", icon: "🛠️" },
  payout_failed: { category: "payments", icon: "🏦" },
  review_received: { category: "reviews", icon: "⭐" },
  review_replied: { category: "reviews", icon: "💬" },
  review_hidden: { category: "reviews", icon: "🚫" },
  message_received: { category: "messages", icon: "✉️" },
  lesson_reminder: { category: "bookings", icon: "⏰" },
  booking_rescheduled: { category: "bookings", icon: "🔁" },
  support_reply: { category: "support", icon: "🎧" },
  account_deletion_requested: { category: "account", icon: "⚠️" },
  account_deletion_cancelled: { category: "account", icon: "↩️" },
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
