import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Stripe redirects the browser here (GET) when a student backs out of
 * Checkout instead of paying. Cancels the still-pending booking
 * immediately rather than waiting for the Checkout Session to expire, so
 * the slot is free for other students right away.
 *
 * Scoped to student_id = the signed-in user and status = pending_payment
 * in the update itself (not just checked beforehand) so this can't cancel
 * someone else's booking or one that already got confirmed by a webhook
 * racing this request.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const bookingId = request.nextUrl.searchParams.get("booking_id");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  if (!bookingId) {
    return NextResponse.redirect(new URL("/student/bookings", appUrl));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", appUrl));
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("tutor_id")
    .eq("id", bookingId)
    .eq("student_id", user.id)
    .maybeSingle();

  await supabase
    .from("bookings")
    .update({ status: "cancelled", cancellation_reason: "Payment cancelled by student" })
    .eq("id", bookingId)
    .eq("student_id", user.id)
    .eq("status", "pending_payment");

  const redirectPath = booking
    ? `/student/tutors/${booking.tutor_id}/book?payment=cancelled`
    : "/student/bookings?payment=cancelled";

  return NextResponse.redirect(new URL(redirectPath, appUrl));
}
