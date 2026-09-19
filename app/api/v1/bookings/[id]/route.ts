import { handle, requireApiUser, apiOk, apiError } from "@/lib/api/handler";
import { createClient } from "@/lib/supabase/server";
import {
  resolveCancellation,
  isCancellable,
  FREE_CANCELLATION_HOURS,
} from "@/lib/booking/cancellation-policy";
import type { BookingStatus } from "@/types/database";

export const dynamic = "force-dynamic";

/**
 * One lesson, plus what the cancellation policy WOULD decide if it were
 * cancelled right now.
 *
 * The preview is computed here rather than in the app for the reason every
 * other rule is: a client-side copy of the refund policy is a second copy that
 * will disagree. It matters more than usual for this one — the app shows the
 * consequence in the confirmation dialog, BEFORE the irreversible tap, so a
 * wrong preview is a person cancelling under a refund promise that was never
 * true.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("GET /api/v1/bookings/[id]", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const supabase = await createClient();

    const { data: booking } = await supabase
      .from("bookings")
      .select(
        `id, student_id, tutor_id, status, start_at, end_at, price_cents, currency,
         lesson_duration_minutes, meeting_url, meeting_status, cancellation_reason,
         subjects(name),
         student:profiles!bookings_student_id_fkey(full_name),
         tutor:profiles!bookings_tutor_id_fkey(full_name)`,
      )
      .eq("id", id)
      .maybeSingle();

    // RLS already scopes bookings to their participants, so an id belonging to
    // someone else simply is not found — the same answer the web gives.
    if (!booking) return apiError("Lesson not found", 404, "not_found");

    const row = booking as unknown as {
      id: string;
      student_id: string;
      tutor_id: string;
      status: BookingStatus;
      start_at: string;
      end_at: string;
      lesson_duration_minutes: number;
      price_cents: number;
      currency: string;
      meeting_url: string | null;
      meeting_status: string;
      cancellation_reason: string | null;
      subjects: { name: string } | null;
      student: { full_name: string } | null;
      tutor: { full_name: string } | null;
    };

    const viewerRole = row.student_id === auth.profile.id ? "student" : "tutor";
    const canCancel = isCancellable(row.status);
    const hoursUntilStart = (new Date(row.start_at).getTime() - Date.now()) / 3_600_000;

    const [{ data: conversation }, { data: existingReview }] = await Promise.all([
      supabase.from("conversations").select("id").eq("booking_id", row.id).maybeSingle(),
      // RLS lets a student see their own review; a tutor sees reviews about
      // them. Either way "has this been reviewed" is answered by whether the
      // row is visible, which is the same question the web bookings list asks.
      supabase.from("reviews").select("id").eq("booking_id", row.id).maybeSingle(),
    ]);
    const reviewed = Boolean(existingReview);

    const preview = canCancel
      ? resolveCancellation({
          status: row.status,
          startAt: new Date(row.start_at),
          pricePaidCents: row.price_cents,
          cancelledBy: viewerRole,
        })
      : null;

    return apiOk({
      booking: {
        id: row.id,
        // Needed by the reschedule screen to load the tutor's open slots, and
        // by the review screen to attribute the review.
        tutor_id: row.tutor_id,
        lesson_duration_minutes: row.lesson_duration_minutes,
        reviewed: reviewed,
        status: row.status,
        start_at: row.start_at,
        end_at: row.end_at,
        price_cents: row.price_cents,
        currency: row.currency,
        meeting_url: row.meeting_url,
        meeting_status: row.meeting_status,
        cancellation_reason: row.cancellation_reason,
        subject_name: row.subjects?.name ?? null,
        student_name: row.student?.full_name ?? "Student",
        tutor_name: row.tutor?.full_name ?? "Tutor",
        conversation_id: conversation?.id ?? null,
      },
      timezone: auth.profile.timezone,
      viewerRole,
      canCancel,
      canReschedule: canCancel && hoursUntilStart >= FREE_CANCELLATION_HOURS,
      cancellationPreview: preview
        ? { refundOwedCents: preview.refundOwedCents, explanation: preview.explanation }
        : null,
    });
  });
}
