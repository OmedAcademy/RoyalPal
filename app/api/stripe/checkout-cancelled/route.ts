import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
 *
 * The write goes through the service role for one reason: migration 0029's
 * column lock lets a client change only `status` and `cancellation_reason`,
 * so this route could not record WHY it cancelled. Every other cancellation
 * path stores the policy that fired and what refund it owed, and a booking
 * cancelled here would have been the one row in the table with that history
 * missing. Ownership is still enforced in the WHERE clause — the service role
 * changes who may write the audit columns, not who may cancel what.
 *
 * `unpaid_no_charge` is correct rather than convenient: the status filter
 * below means this only ever touches a booking that was never paid for, which
 * is exactly the rule resolveCancellation applies to pending_payment.
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

  await createAdminClient()
    .from("bookings")
    .update({
      status: "cancelled",
      cancellation_reason: "Payment cancelled by student",
      cancelled_at: new Date().toISOString(),
      cancelled_by: user.id,
      cancellation_policy: "unpaid_no_charge",
      refund_owed_cents: 0,
    })
    .eq("id", bookingId)
    .eq("student_id", user.id)
    .eq("status", "pending_payment");

  const redirectPath = booking
    ? `/student/tutors/${booking.tutor_id}/book?payment=cancelled`
    : "/student/bookings?payment=cancelled";

  return NextResponse.redirect(new URL(redirectPath, appUrl));
}
