import { NextResponse } from "next/server";
import { authorizeCron, runJob } from "@/lib/cron/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NotificationService } from "@/lib/notifications/service";

export const dynamic = "force-dynamic";

/**
 * Lesson reminders, roughly an hour ahead.
 *
 * THE WINDOW, AND WHY IT IS A WINDOW
 * The job runs every 15 minutes and reminds about lessons starting between 45
 * and 75 minutes from now. An exact "60 minutes before" would miss every
 * lesson whose start does not line up with a tick, and a window narrower than
 * the interval would miss lessons in the gaps. The window is wider than the
 * interval on purpose, which means a lesson can fall inside two consecutive
 * runs — hence the duplicate guard below, without which a late-running job
 * would send the same reminder twice.
 *
 * The guard is a query against notifications rather than a column on bookings:
 * "have we already told this person about this lesson" is a question about
 * notifications, and putting a reminded_at flag on bookings would be a second
 * source of truth that can disagree with what was actually sent.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = authorizeCron(request);
  if (denied) return denied;

  return runJob("reminders", async () => {
    const admin = createAdminClient();
    const from = new Date(Date.now() + 45 * 60_000).toISOString();
    const to = new Date(Date.now() + 75 * 60_000).toISOString();

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
      .gte("created_at", new Date(Date.now() - 6 * 3_600_000).toISOString())
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
