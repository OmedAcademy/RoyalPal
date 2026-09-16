import "server-only";
import { createClient } from "@/lib/supabase/server";
import { runBookingMaintenance } from "@/lib/supabase/maintenance";
import type { Booking } from "@/types/database";

export type BookingWithParties = Booking & {
  student_name: string;
  tutor_name: string;
  subject_name: string;
  reviewed: boolean;
};

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
};

const BOOKING_SELECT =
  "*, student:profiles!bookings_student_id_fkey(full_name), tutor_profiles!bookings_tutor_id_fkey(profiles!tutor_profiles_id_fkey(full_name)), subjects(name), reviews(id)";

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

  return (data ?? []).map((row) => {
    const { student, tutor_profiles, subjects, reviews, ...booking } = row;
    return {
      ...booking,
      student_name: student?.full_name ?? "Student",
      tutor_name: tutor_profiles?.profiles?.full_name ?? "Tutor",
      subject_name: subjects?.name ?? "Lesson",
      reviewed: reviews !== null,
    };
  });
}
