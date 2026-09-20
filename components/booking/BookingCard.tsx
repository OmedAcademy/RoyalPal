import type { BookingWithParties } from "@/lib/supabase/bookings";
import { CancelBookingButton } from "@/components/booking/CancelBookingButton";
import { RetryPaymentButton } from "@/components/booking/RetryPaymentButton";
import { ReviewForm } from "@/components/review/ReviewForm";
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_STYLES } from "@/lib/utils/booking-status";
import { formatMoney } from "@/lib/utils/format";
import Link from "next/link";
import { safeExternalUrl } from "@/lib/utils/url";
import { FREE_CANCELLATION_HOURS } from "@/lib/booking/cancellation-policy";

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
  // Decided on the server (lib/supabase/bookings.ts), where the payment
  // condition from the reviews policy can actually be checked.
  const canReview = booking.can_review;
  // Same notice as the free-cancellation window, so moving a lesson can never
  // be used to walk around the cancellation policy — see
  // RESCHEDULE_MIN_NOTICE_HOURS in lib/actions/booking.ts.
  const hoursUntilStart = (new Date(booking.start_at).getTime() - Date.now()) / 3_600_000;
  const canReschedule = canCancel && hoursUntilStart >= FREE_CANCELLATION_HOURS;

  // The window opens at a moment the server decides; whether it has ARRIVED
  // is decided here, against the reader's own clock, so a page left open
  // reaches it rather than staying stale.
  const now = Date.now();
  const endMs = new Date(booking.end_at).getTime();
  const withinJoinWindow = now >= new Date(booking.join_opens_at).getTime() && now <= endMs;
  const isLive = now >= new Date(booking.start_at).getTime() && now <= endMs;
  const joinUrl =
    booking.status === "confirmed" && withinJoinWindow
      ? safeExternalUrl(booking.meeting_url)
      : null;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: viewerTimezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="shadow-luxe border-hairline bg-surface flex flex-col gap-2 rounded-2xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            {booking.subject_name} with {otherPartyName}
          </p>
          <p className="text-muted text-sm">{formatter.format(new Date(booking.start_at))}</p>
        </div>
        <span
          className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${BOOKING_STATUS_STYLES[booking.status]}`}
        >
          {BOOKING_STATUS_LABELS[booking.status]}
        </span>
      </div>

      <p className="text-muted text-sm">
        {booking.lesson_duration_minutes} min &middot;{" "}
        {formatMoney(booking.price_cents, booking.currency)}
      </p>

      {booking.cancellation_reason && (
        <p className="text-muted text-sm">Reason: {booking.cancellation_reason}</p>
      )}

      {/* The live classroom. Both parties see the SAME Meet URL (one calendar
          event, two attendees). Shown from 15 minutes before the start until
          the lesson ends, so the link doesn't invite people to join days
          early. safeExternalUrl re-validates the scheme because this value
          reaches an href. */}
      {joinUrl && (
        <a
          href={joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-royal text-royal-contrast shadow-luxe mt-1 inline-flex h-10 w-fit items-center gap-2 rounded-full px-4 text-sm font-medium transition-transform hover:-translate-y-0.5"
        >
          <span aria-hidden="true">🎥</span>
          {isLive ? "Join lesson now" : "Join lesson"}
        </a>
      )}

      {/* Meeting creation failed (e.g. Google outage). The lesson is still
          confirmed and paid — say so plainly rather than silently showing
          nothing, and reassure that a link is coming. */}
      {booking.status === "confirmed" && booking.meeting_status === "failed" && (
        <p className="text-muted text-sm">
          We&apos;re still preparing your video link — it will appear here shortly.
        </p>
      )}

      {(canRetryPayment || canCancel) && (
        <div className="flex flex-wrap items-center gap-2">
          {canRetryPayment && <RetryPaymentButton bookingId={booking.id} />}
          {canReschedule && (
            <Link
              href={`/${viewerRole}/bookings/${booking.id}/reschedule`}
              className="border-hairline-strong hover:border-royal inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:outline-none"
            >
              Move lesson
            </Link>
          )}
          {canCancel && <CancelBookingButton bookingId={booking.id} />}
        </div>
      )}

      {canReview && <ReviewForm bookingId={booking.id} tutorName={booking.tutor_name} />}
    </div>
  );
}
