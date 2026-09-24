import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * How long a pending_payment row may hold a tutor's slot. Matches the
 * Checkout Session lifetime (30 minutes) plus a grace period so a payment
 * that clears at the end of the session is not cancelled out from under it.
 */
export const PENDING_PAYMENT_GRACE_MINUTES = 45;

type Admin = SupabaseClient<Database>;

/**
 * Clock-driven booking transitions. Idempotent: each statement's WHERE is
 * the condition being fixed, so a second call in the same moment updates
 * nothing.
 *
 * Called from the daily cron AND from booking reads/writes. Hobby cron can
 * run only once a day, which is too slow to release a 45-minute hold or to
 * mark a lesson complete in time for a review. The request path is what
 * keeps an active marketplace honest; the cron is the backstop for a day
 * when nobody opens the app.
 */
export async function advanceLessonLifecycle(admin: Admin): Promise<{
  completed: number;
  expired: number;
}> {
  const nowIso = new Date().toISOString();
  const pendingCutoff = new Date(Date.now() - PENDING_PAYMENT_GRACE_MINUTES * 60_000).toISOString();

  const { data: completed, error: completedError } = await admin
    .from("bookings")
    .update({ status: "completed" })
    .eq("status", "confirmed")
    .lt("end_at", nowIso)
    .select("id");

  if (completedError) throw completedError;

  const { data: expired, error: expiredError } = await admin
    .from("bookings")
    .update({
      status: "cancelled",
      cancellation_reason: "Payment session expired",
      cancelled_at: nowIso,
      cancellation_policy: "unpaid_no_charge",
      refund_owed_cents: 0,
    })
    .eq("status", "pending_payment")
    .lt("created_at", pendingCutoff)
    .select("id");

  if (expiredError) throw expiredError;

  return {
    completed: completed?.length ?? 0,
    expired: expired?.length ?? 0,
  };
}
