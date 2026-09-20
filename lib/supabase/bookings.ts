import "server-only";
import { createClient } from "@/lib/supabase/server";
import { runBookingMaintenance } from "@/lib/supabase/maintenance";
import type { Booking } from "@/types/database";

export type BookingWithParties = Booking & {
  student_name: string;
  tutor_name: string;
  subject_name: string;
  reviewed: boolean;
  /** When the Join button starts working. A timestamp rather than a boolean:
   * the policy belongs on the server, but whether the moment has ARRIVED has
   * to be decided against the reader's own clock, or a screen left open goes
   * quietly stale. */
  join_opens_at: string;
  /** Whether this viewer may review this lesson, decided here rather than in
   * each client. Both clients derived it from status and `reviewed` alone,
   * which is weaker than the RLS policy — so a student could be shown a review
   * form for an unpaid lesson and refused after writing it. */
  can_review: boolean;
};

/**
 * How early a lesson can be joined.
 *
 * Was hand-copied into the web BookingCard and the mobile one, each with a
 * comment claiming it matched the other. Two copies of a number, each
 * documenting that it agrees with a copy it cannot see, is the arrangement
 * where a change lands in one of them.
 */
export const JOIN_WINDOW_MINUTES = 15;

type RawBookingRow = Booking & {
  student: { full_name: string } | null;
  // bookings.tutor_id references tutor_profiles(id), not profiles(id)
  // directly, so getting the tutor's name is a two-hop embed.
  tutor_profiles: { profiles: { full_name: string } | null } | null;
  subjects: { name: string } | null;
  // reviews.booking_id is UNIQUE, so PostgREST resolves this embed as a
  // one-to-one relationship: a single object when a review exists, null
  // otherwise — NOT an array.
  reviews: { id: string } | null;
  // payments.booking_id is UNIQUE, so this embed is one-to-one too.
  payments: { status: string } | null;
};

const BOOKING_SELECT =
  "*, student:profiles!bookings_student_id_fkey(full_name), tutor_profiles!bookings_tutor_id_fkey(profiles!tutor_profiles_id_fkey(full_name)), subjects(name), reviews(id), payments(status)";

export async function getBookingsFor(
  userId: string,
  role: "student" | "tutor",
): Promise<BookingWithParties[]> {
  await runBookingMaintenance();

  const supabase = await createClient();
  const column = role === "student" ? "student_id" : "tutor_id";

  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq(column, userId)
    .order("start_at", { ascending: true })
    .returns<RawBookingRow[]>();

  if (error) throw error;

  return (data ?? []).map((row) => toBookingWithParties(row, role));
}

function toBookingWithParties(row: RawBookingRow, role: "student" | "tutor"): BookingWithParties {
  const { student, tutor_profiles, subjects, reviews, payments, ...booking } = row;
  return {
    ...booking,
    student_name: student?.full_name ?? "Student",
    tutor_name: tutor_profiles?.profiles?.full_name ?? "Tutor",
    subject_name: subjects?.name ?? "Lesson",
    reviewed: reviews !== null,
    join_opens_at: new Date(
      new Date(booking.start_at).getTime() - JOIN_WINDOW_MINUTES * 60_000,
    ).toISOString(),
    // The payment condition mirrors the insert policy on reviews (0042). A
    // client that offers the form without it is offering a refusal.
    can_review:
      role === "student" &&
      booking.status === "completed" &&
      reviews === null &&
      payments?.status === "succeeded",
  };
}
