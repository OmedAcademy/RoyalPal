import { NextResponse } from "next/server";
import { authorizeCron, runJob } from "@/lib/cron/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NotificationService } from "@/lib/notifications/service";

export const dynamic = "force-dynamic";

/**
 * Daily lesson reminder.
 *
 * Hobby cron can run only once a day, so this is not a 60-minute warning.
 * It tells both people about every confirmed lesson that starts in the next
 * 24 hours and has not already been reminded. The duplicate guard is a
 * query against notifications, not a flag on the booking: "have we already
 * told this person" is a question about what was sent.
 *
 * A lesson booked after this job has run is not reminded until the next
 * morning. Minute-accurate reminders need a plan that allows sub-daily cron.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = authorizeCron(request);
  if (denied) return denied;

  return runJob("reminders", async () => {
    const admin = createAdminClient();
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 24 * 3_600_000).toISOString();

    const { data: bookings, error } = await admin
      .from("bookings")
      .select("id, student_id, tutor_id, start_at")
      .eq("status", "confirmed")
      .gte("start_at", from)
      .lte("start_at", to)
      .limit(500);

    if (error) throw error;
    if (!bookings || bookings.length === 0) return { reminded: 0, skipped: 0 };

    // One query for every already-sent reminder in this batch, rather than one
    // per booking.
    const { data: alreadySent } = await admin
      .from("notifications")
      .select("data")
      .eq("type", "lesson_reminder")
      .gte("created_at", new Date(Date.now() - 30 * 3_600_000).toISOString())
      .limit(2000);

    const sentBookingIds = new Set(
      (alreadySent ?? [])
        .map((row) => (row.data as { bookingId?: string } | null)?.bookingId)
        .filter((id): id is string => typeof id === "string"),
    );

    let reminded = 0;
    let skipped = 0;

    for (const booking of bookings) {
      if (sentBookingIds.has(booking.id)) {
        skipped += 1;
        continue;
      }

      await NotificationService.emitMany([
        {
          userId: booking.student_id,
          type: "lesson_reminder",
          title: "Your lesson starts in about an hour",
          body: "Open RoyalPal a few minutes early to check your camera and mic.",
          data: { href: "/student/bookings", bookingId: booking.id },
        },
        {
          userId: booking.tutor_id,
          type: "lesson_reminder",
          title: "You're teaching in about an hour",
          body: "Your student has been reminded too.",
          data: { href: "/tutor/bookings", bookingId: booking.id },
        },
      ]);
      reminded += 1;
    }

    return { reminded, skipped };
  });
}
