import type { BookingWithParties } from "@/lib/supabase/bookings";
import { CancelBookingButton } from "@/components/booking/CancelBookingButton";
import { RetryPaymentButton } from "@/components/booking/RetryPaymentButton";

const STATUS_LABELS: Record<BookingWithParties["status"], string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const STATUS_STYLES: Record<BookingWithParties["status"], string> = {
  pending_payment: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  confirmed: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  completed: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  refunded: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

function priceLabel(cents: number, currency: string): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

export function BookingCard({
  booking,
  viewerRole,
  viewerTimezone,
}: {
  booking: BookingWithParties;
  viewerRole: "student" | "tutor";
  viewerTimezone: string;
}) {
  const otherPartyName = viewerRole === "student" ? booking.tutor_name : booking.student_name;
  const isUpcoming = new Date(booking.start_at).getTime() > Date.now();
  const canCancel =
    (booking.status === "pending_payment" || booking.status === "confirmed") && isUpcoming;
  // Only the student can pay; a pending_payment booking that's still in the
  // future can always start a fresh Checkout Session (retryBookingPayment
  // re-validates everything server-side).
  const canRetryPayment =
    viewerRole === "student" && booking.status === "pending_payment" && isUpcoming;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: viewerTimezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            {booking.subject_name} with {otherPartyName}
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatter.format(new Date(booking.start_at))}
          </p>
        </div>
        <span
          className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[booking.status]}`}
        >
          {STATUS_LABELS[booking.status]}
        </span>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {booking.lesson_duration_minutes} min &middot;{" "}
        {priceLabel(booking.price_cents, booking.currency)}
      </p>

      {booking.cancellation_reason && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Reason: {booking.cancellation_reason}
        </p>
      )}

      {(canRetryPayment || canCancel) && (
        <div className="flex flex-wrap items-center gap-2">
          {canRetryPayment && <RetryPaymentButton bookingId={booking.id} />}
          {canCancel && <CancelBookingButton bookingId={booking.id} />}
        </div>
      )}
    </div>
  );
}
