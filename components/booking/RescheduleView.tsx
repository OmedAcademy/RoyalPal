import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTutorAvailableSlots } from "@/lib/supabase/availability";
import { RescheduleForm } from "@/components/booking/RescheduleForm";
import { formatDateTimeIn, formatTimeIn, timeZoneLabel, formatDateIn } from "@/lib/utils/format";
import { utcToZonedParts } from "@/lib/utils/timezone";
import { FREE_CANCELLATION_HOURS, isCancellable } from "@/lib/booking/cancellation-policy";
import type { BookingStatus } from "@/types/database";

export type SlotGroup = {
  date: string;
  label: string;
  slots: { startAt: string; label: string }[];
};

/**
 * Shared by the student and tutor reschedule pages.
 *
 * Slots are grouped and labelled in the VIEWER's time zone, not the tutor's.
 * The booking page still renders in the tutor's zone (and says so), but a
 * person choosing a new time for a lesson they already own is answering "when
 * can I be there", and that question only has one correct clock.
 */
export async function RescheduleView({
  bookingId,
  viewerId,
  viewerRole,
  viewerTimezone,
}: {
  bookingId: string;
  viewerId: string;
  viewerRole: "student" | "tutor";
  viewerTimezone: string;
}) {
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, student_id, tutor_id, status, start_at, lesson_duration_minutes")
    .eq("id", bookingId)
    .maybeSingle();

  // RLS already scopes bookings to participants; this makes "someone else's"
  // and "does not exist" the same answer here too.
  if (!booking || (booking.student_id !== viewerId && booking.tutor_id !== viewerId)) {
    notFound();
  }

  const hoursUntilStart = (new Date(booking.start_at).getTime() - Date.now()) / 3_600_000;
  const movable =
    isCancellable(booking.status as BookingStatus) && hoursUntilStart >= FREE_CANCELLATION_HOURS;

  const { data: tutorAccount } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", booking.tutor_id)
    .maybeSingle();

  const slots = movable
    ? await getTutorAvailableSlots({
        tutorId: booking.tutor_id,
        timeZone: tutorAccount?.timezone ?? "UTC",
        durationMinutes: booking.lesson_duration_minutes,
      })
    : [];

  const groups = new Map<string, SlotGroup>();
  for (const slot of slots) {
    // Never offer the time it is already at — the RPC refuses it, and an
    // option that always errors is worse than no option.
    if (slot.startAt.getTime() === new Date(booking.start_at).getTime()) continue;

    const { date } = utcToZonedParts(slot.startAt, viewerTimezone);
    if (!groups.has(date)) {
      groups.set(date, { date, label: formatDateIn(slot.startAt, viewerTimezone), slots: [] });
    }
    groups.get(date)!.slots.push({
      startAt: slot.startAt.toISOString(),
      label: formatTimeIn(slot.startAt, viewerTimezone),
    });
  }

  const backHref = `/${viewerRole}/bookings`;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div>
        <Link href={backHref} className="text-muted hover:text-foreground text-sm">
          ← Back to lessons
        </Link>
        <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight">
          Move this lesson
        </h1>
        <p className="text-muted mt-1 text-sm">
          Currently {formatDateTimeIn(booking.start_at, viewerTimezone)} (
          {timeZoneLabel(booking.start_at, viewerTimezone)}). Moving a lesson doesn&apos;t change
          what was paid.
        </p>
      </div>

      {!movable ? (
        <p
          role="status"
          className="border-hairline text-muted rounded-xl border border-dashed px-4 py-3 text-sm"
        >
          This lesson can&apos;t be moved — either it is no longer upcoming, or it starts within{" "}
          {FREE_CANCELLATION_HOURS} hours. Cancel it instead if you can&apos;t make it.
        </p>
      ) : groups.size === 0 ? (
        <p
          role="status"
          className="border-hairline text-muted rounded-xl border border-dashed px-4 py-3 text-sm"
        >
          {viewerRole === "student"
            ? "This tutor has no other open slots at the moment. Try again later, or cancel and rebook."
            : "You have no other open slots. Add availability first, then move the lesson."}
        </p>
      ) : (
        <RescheduleForm
          bookingId={booking.id}
          groups={[...groups.values()]}
          timeZoneLabel={timeZoneLabel(booking.start_at, viewerTimezone)}
        />
      )}
    </div>
  );
}
