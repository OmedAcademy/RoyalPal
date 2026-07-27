import type { BookingWithParties } from "@/lib/supabase/bookings";
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_STYLES } from "@/lib/utils/booking-status";
import { formatMoney } from "@/lib/utils/format";

/**
 * Compact one-line lesson summary for the dashboards (distinct from the
 * fuller BookingCard, which carries cancel/pay/review actions). Times render
 * in the viewer's own timezone.
 */
export function LessonRow({
  booking,
  viewerRole,
  viewerTimezone,
  showStatus = true,
}: {
  booking: BookingWithParties;
  viewerRole: "student" | "tutor";
  viewerTimezone: string;
  showStatus?: boolean;
}) {
  const otherParty = viewerRole === "student" ? booking.tutor_name : booking.student_name;
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: viewerTimezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(booking.start_at));

  return (
    <div className="border-hairline flex items-center justify-between gap-3 border-b py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {booking.subject_name} · {otherParty}
        </p>
        <p className="text-muted mt-0.5 text-xs">
          {when} · {booking.lesson_duration_minutes} min
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-medium">
          {formatMoney(booking.price_cents, booking.currency)}
        </span>
        {showStatus && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BOOKING_STATUS_STYLES[booking.status]}`}
          >
            {BOOKING_STATUS_LABELS[booking.status]}
          </span>
        )}
      </div>
    </div>
  );
}
