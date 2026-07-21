import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Booking } from "@/types/database";

/** No scheduler/cron exists yet to flip a lesson to 'completed' once it's
 * over, so each booking-list page view does a lazy sweep instead: any
 * confirmed booking whose end_at has passed is past-due for completion.
 * Scoped best-effort — a failure here shouldn't block rendering the page. */
export async function syncCompletedBookings(): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("bookings")
    .update({ status: "completed" })
    .eq("status", "confirmed")
    .lt("end_at", new Date().toISOString());
}

/** Checkout Sessions expire 30 minutes after creation (see
 * lib/stripe/checkout.ts) and the webhook cancels the booking when that
 * happens — this is a backstop for the rare case that event is dropped, so
 * a stuck pending_payment booking doesn't block its slot forever. Grace
 * period is wider than the session lifetime to avoid racing a webhook that
 * simply hasn't been delivered yet. */
const PENDING_PAYMENT_GRACE_MINUTES = 45;

export async function syncExpiredPendingBookings(): Promise<void> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_GRACE_MINUTES * 60_000).toISOString();
  await admin
    .from("bookings")
    .update({ status: "cancelled", cancellation_reason: "Payment session expired" })
    .eq("status", "pending_payment")
    .lt("created_at", cutoff);
}

export type BookingWithParties = Booking & {
  student_name: string;
  tutor_name: string;
  subject_name: string;
};

type RawBookingRow = Booking & {
  student: { full_name: string } | null;
  // bookings.tutor_id references tutor_profiles(id), not profiles(id)
  // directly, so getting the tutor's name is a two-hop embed.
  tutor_profiles: { profiles: { full_name: string } | null } | null;
  subjects: { name: string } | null;
};

const BOOKING_SELECT =
  "*, student:profiles!bookings_student_id_fkey(full_name), tutor_profiles!bookings_tutor_id_fkey(profiles!tutor_profiles_id_fkey(full_name)), subjects(name)";

export async function getBookingsFor(
  userId: string,
  role: "student" | "tutor",
): Promise<BookingWithParties[]> {
  await Promise.all([syncCompletedBookings(), syncExpiredPendingBookings()]);

  const supabase = await createClient();
  const column = role === "student" ? "student_id" : "tutor_id";

  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq(column, userId)
    .order("start_at", { ascending: true })
    .returns<RawBookingRow[]>();

  if (error) throw error;

  return (data ?? []).map((row) => {
    const { student, tutor_profiles, subjects, ...booking } = row;
    return {
      ...booking,
      student_name: student?.full_name ?? "Student",
      tutor_name: tutor_profiles?.profiles?.full_name ?? "Tutor",
      subject_name: subjects?.name ?? "Lesson",
    };
  });
}
