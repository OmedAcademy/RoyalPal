import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";
import { googleMeetProvider } from "@/lib/meet/google";
import { TransientMeetingError, type MeetingProvider } from "@/lib/meet/provider";

/**
 * The only entry point booking logic uses for live classrooms.
 *
 * Guarantees the callers depend on:
 *  • Never throws. Meetings are created from the Stripe webhook *after* money
 *    has been captured — a Google outage must not fail the payment, orphan the
 *    booking, or make Stripe retry a settled event. Failures are recorded as
 *    meeting_status='failed' for a retry sweep.
 *  • Idempotent. A booking that already has a calendar_event_id is returned
 *    as-is, so at-least-once webhook delivery cannot create two Meet rooms.
 *  • Rolls back. If the provider creates an event but persisting it fails, the
 *    event is deleted rather than left orphaned in the calendar.
 */

export type MeetingStatus = "pending" | "scheduled" | "failed" | "cancelled";

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 200;

const log = logger.child({ component: "meeting-service" });

/** Swappable for tests and future providers (Zoom, Teams, RoyalPal Live). */
let provider: MeetingProvider = googleMeetProvider;

export function __setMeetingProvider(next: MeetingProvider): void {
  provider = next;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries only transient failures, with exponential backoff. */
async function withRetry<T>(op: () => Promise<T>, context: Record<string, unknown>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      if (!(err instanceof TransientMeetingError) || attempt === MAX_ATTEMPTS) throw err;
      log.warn("transient meeting-provider failure, retrying", { ...context, attempt });
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

type BookingRow = {
  id: string;
  start_at: string;
  end_at: string;
  student_id: string;
  tutor_id: string;
  status: string;
  calendar_event_id: string | null;
  meeting_url: string | null;
  meeting_provider: string | null;
};

/** Resolves a participant's email; addresses live in auth.users, never mirrored. */
async function participant(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<{ email: string; name?: string } | null> {
  const [{ data: authUser }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);

  const email = authUser.user?.email;
  if (!email) return null;
  return { email, name: profile?.full_name ?? undefined };
}

export const MeetingService = {
  /**
   * Creates the live classroom for a confirmed booking. Safe to call more than
   * once for the same booking.
   */
  async createMeeting(bookingId: string): Promise<void> {
    const scoped = log.child({ bookingId });

    try {
      const admin = createAdminClient();

      const { data: booking } = await admin
        .from("bookings")
        .select(
          "id, start_at, end_at, student_id, tutor_id, status, calendar_event_id, meeting_url, meeting_provider",
        )
        .eq("id", bookingId)
        .maybeSingle<BookingRow>();

      if (!booking) return;

      // Idempotency: a duplicate webhook delivery must not mint a second room.
      if (booking.calendar_event_id) return;

      if (!provider.isConfigured()) {
        scoped.info("meeting provider not configured; skipping", { provider: provider.name });
        return;
      }

      const [tutor, student, subject] = await Promise.all([
        participant(admin, booking.tutor_id),
        participant(admin, booking.student_id),
        admin
          .from("bookings")
          .select("subjects(name)")
          .eq("id", bookingId)
          .maybeSingle<{ subjects: { name: string } | null }>(),
      ]);

      if (!tutor || !student) {
        scoped.error("cannot create meeting without both participant emails");
        await admin.from("bookings").update({ meeting_status: "failed" }).eq("id", bookingId);
        return;
      }

      const subjectName = subject.data?.subjects?.name ?? "Lesson";

      const meeting = await withRetry(
        () =>
          provider.createMeeting({
            bookingId,
            subject: `RoyalPal — ${subjectName} with ${tutor.name ?? "your tutor"}`,
            description: "Your RoyalPal lesson. Join with the link below.",
            startAt: booking.start_at,
            endAt: booking.end_at,
            // UTC: start_at/end_at are absolute instants. Attendees' own
            // calendars render them in their local zone automatically.
            timeZone: "UTC",
            tutor,
            student,
          }),
        { bookingId },
      );

      const { error: persistError } = await admin
        .from("bookings")
        .update({
          meeting_provider: meeting.provider,
          meeting_url: meeting.meetingUrl,
          meeting_id: meeting.meetingId,
          calendar_event_id: meeting.calendarEventId,
          meeting_status: "scheduled",
        })
        .eq("id", bookingId);

      if (persistError) {
        // Roll back the remote event so we don't leave an orphaned Meet room
        // that nobody can find, cancel, or reconcile.
        scoped.error("failed to persist meeting; rolling back calendar event", persistError, {
          calendarEventId: meeting.calendarEventId,
        });
        await provider.cancelMeeting(meeting.calendarEventId).catch((err) => {
          scoped.error("rollback of calendar event failed", err);
        });
        return;
      }

      scoped.info("meeting scheduled", { provider: meeting.provider });
    } catch (err) {
      // Never propagate: the payment is already captured.
      scoped.error("meeting creation failed", err);
      try {
        await createAdminClient()
          .from("bookings")
          .update({ meeting_status: "failed" })
          .eq("id", bookingId);
      } catch (markErr) {
        scoped.error("could not mark meeting_status=failed", markErr);
      }
    }
  },

  /** Cancels the live classroom for a booking. Safe if none exists. */
  async cancelMeeting(bookingId: string): Promise<void> {
    const scoped = log.child({ bookingId });

    try {
      const admin = createAdminClient();
      const { data: booking } = await admin
        .from("bookings")
        .select("calendar_event_id")
        .eq("id", bookingId)
        .maybeSingle<{ calendar_event_id: string | null }>();

      if (!booking?.calendar_event_id) return;
      if (!provider.isConfigured()) return;

      await withRetry(() => provider.cancelMeeting(booking.calendar_event_id!), { bookingId });

      // Keep calendar_event_id for audit; status marks it invalidated.
      await admin
        .from("bookings")
        .update({ meeting_status: "cancelled", meeting_url: null })
        .eq("id", bookingId);

      scoped.info("meeting cancelled");
    } catch (err) {
      scoped.error("meeting cancellation failed", err);
    }
  },

  /**
   * Moves an existing meeting to a new time, preserving the Meet URL so links
   * already shared with attendees keep working.
   */
  async rescheduleMeeting(bookingId: string, startAt: string, endAt: string): Promise<void> {
    const scoped = log.child({ bookingId });

    try {
      const admin = createAdminClient();
      const { data: booking } = await admin
        .from("bookings")
        .select("calendar_event_id")
        .eq("id", bookingId)
        .maybeSingle<{ calendar_event_id: string | null }>();

      // Nothing scheduled yet — create it instead of failing.
      if (!booking?.calendar_event_id) {
        await this.createMeeting(bookingId);
        return;
      }
      if (!provider.isConfigured()) return;

      const meeting = await withRetry(
        () =>
          provider.rescheduleMeeting({
            calendarEventId: booking.calendar_event_id!,
            startAt,
            endAt,
            timeZone: "UTC",
          }),
        { bookingId },
      );

      await admin
        .from("bookings")
        .update({
          meeting_url: meeting.meetingUrl,
          meeting_id: meeting.meetingId,
          meeting_status: "scheduled",
        })
        .eq("id", bookingId);

      scoped.info("meeting rescheduled");
    } catch (err) {
      scoped.error("meeting reschedule failed", err);
    }
  },
};
