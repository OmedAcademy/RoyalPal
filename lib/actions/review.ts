"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { activeUserOrError } from "@/lib/supabase/queries";
import { createReviewSchema } from "@/lib/validations/review";
import { NotificationService } from "@/lib/notifications/service";

export type ReviewActionState = {
  error?: string;
  message?: string;
};

const UNIQUE_VIOLATION = "23505";

/**
 * The database is the real gatekeeper here: RLS only permits inserting a
 * review for the caller's own completed booking, the unique constraint on
 * booking_id caps it at one review per booking, and reviews are immutable
 * (no update/delete policy). This action just shapes input and errors.
 */
export async function createReview(
  _prevState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const parsed = createReviewSchema.safeParse({
    bookingId: formData.get("bookingId"),
    rating: formData.get("rating"),
    comment: formData.get("comment"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) {
    return { error: auth.error };
  }
  const user = auth.user;

  const { data: booking } = await supabase
    .from("bookings")
    .select("tutor_id, status")
    .eq("id", parsed.data.bookingId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (!booking) {
    return { error: "Booking not found" };
  }

  if (booking.status !== "completed") {
    return { error: "You can review a lesson once it's completed" };
  }

  const { error } = await supabase.from("reviews").insert({
    booking_id: parsed.data.bookingId,
    student_id: user.id,
    tutor_id: booking.tutor_id,
    rating: parsed.data.rating,
    comment: parsed.data.comment,
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { error: "You've already reviewed this lesson" };
    }
    return { error: error.message };
  }

  // Notify the tutor (best-effort — never blocks the review).
  await NotificationService.emit({
    userId: booking.tutor_id,
    type: "review_received",
    title: "You received a new review",
    body:
      `${parsed.data.rating}★` +
      (parsed.data.comment ? ` — “${parsed.data.comment.slice(0, 80)}”` : ""),
    data: { href: "/tutor/dashboard" },
  });

  revalidatePath("/student/bookings");
  revalidatePath(`/student/tutors/${booking.tutor_id}`);

  return { message: "Thanks — your review is live." };
}
