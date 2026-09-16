import "server-only";
import { createClient } from "@/lib/supabase/server";
import { computeAvailableSlots, type AvailableSlot } from "@/lib/utils/availability-slots";

const BOOKABLE_DAYS = 14;

export async function getTutorAvailableSlots({
  tutorId,
  timeZone,
  durationMinutes,
}: {
  tutorId: string;
  timeZone: string;
  durationMinutes: number;
}): Promise<AvailableSlot[]> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: rules }, { data: exceptions }, { data: bookings }] = await Promise.all([
    supabase
      .from("availability_rules")
      .select("day_of_week, start_time, end_time")
      .eq("tutor_id", tutorId),
    supabase
      .from("availability_exceptions")
      .select("date, start_time, end_time, is_available")
      .eq("tutor_id", tutorId)
      .gte("date", today),
    supabase
      .from("bookings")
      .select("start_at, end_at")
      .eq("tutor_id", tutorId)
      .in("status", ["pending_payment", "confirmed"])
      .gte("start_at", new Date().toISOString()),
  ]);

  return computeAvailableSlots({
    rules: rules ?? [],
    exceptions: exceptions ?? [],
    busyRanges: (bookings ?? []).map((b) => ({ start_at: b.start_at, end_at: b.end_at })),
    timeZone,
    startDate: today,
    days: BOOKABLE_DAYS,
    durationMinutes,
  });
}
