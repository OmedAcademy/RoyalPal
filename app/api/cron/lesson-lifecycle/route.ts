import { NextResponse } from "next/server";
import { authorizeCron, runJob } from "@/lib/cron/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const PENDING_PAYMENT_GRACE_MINUTES = 45;

/**
 * Moves lessons through the states that depend only on the clock.
 *
 * REPLACES the page-view-triggered sweep in lib/supabase/maintenance.ts. That
 * version ran when somebody happened to load a bookings page, throttled by a
 * module-level variable that on Vercel is per-lambda-instance — so on a quiet
 * weekend no lesson completed at all, and under load the throttle enforced
 * nothing. Reviews require a completed lesson, so "nobody visited" silently
 * meant "nobody can review".
 *
 * IDEMPOTENT by construction: each statement's WHERE clause is the condition
 * being fixed, so re-running finds nothing to do. Safe to retry, safe to run
 * twice concurrently, safe to run after a partial failure.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = authorizeCron(request);
  if (denied) return denied;

  return runJob("lesson-lifecycle", async () => {
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();
    const pendingCutoff = new Date(
      Date.now() - PENDING_PAYMENT_GRACE_MINUTES * 60_000,
    ).toISOString();

    // A confirmed lesson whose end time has passed happened. Only the service
    // role may make this transition (migration 0006's status trigger), which
    // is why this runs through the admin client.
    const { data: completed, error: completedError } = await admin
      .from("bookings")
      .update({ status: "completed" })
      .eq("status", "confirmed")
      .lt("end_at", nowIso)
      .select("id");

    if (completedError) throw completedError;

    // An unpaid booking that outlived its Checkout Session is holding a slot
    // nobody is going to pay for. Releasing it is what makes the tutor's
    // calendar honest.
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
  });
}
