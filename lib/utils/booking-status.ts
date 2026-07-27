import type { BookingStatus } from "@/types/database";

/** Human labels + badge styles for booking statuses. Shared by the bookings
 * list and the dashboards so the vocabulary and colours stay identical. */
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const BOOKING_STATUS_STYLES: Record<BookingStatus, string> = {
  pending_payment: "bg-amber-100 text-amber-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  completed: "bg-slate-100 text-slate-700",
  cancelled: "bg-red-100 text-red-700",
  refunded: "bg-red-100 text-red-700",
};
