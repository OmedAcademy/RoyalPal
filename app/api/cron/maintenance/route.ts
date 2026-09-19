import { NextResponse } from "next/server";
import { authorizeCron, runJob } from "@/lib/cron/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { anonymizeDueAccounts } from "@/lib/account/anonymize";

export const dynamic = "force-dynamic";

/** Days after a lesson ends before its conversation stops taking messages. */
const CONVERSATION_OPEN_DAYS = 14;

/**
 * Daily housekeeping: close finished conversations, sweep expired rate-limit
 * windows, and carry out account deletions whose grace period has passed.
 *
 * Every step is independent and idempotent, and each is wrapped so one
 * failure does not abandon the others — a rate-limit table that cannot be
 * pruned must not stop an erasure request being honoured.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = authorizeCron(request);
  if (denied) return denied;

  return runJob("maintenance", async () => {
    const admin = createAdminClient();
    const results: Record<string, number | string> = {};

    // 1. Close conversations for lessons that finished a while ago. The thread
    //    stays readable forever — closing only stops new messages, so an old
    //    booking cannot be used as a permanent private channel.
    try {
      const cutoff = new Date(Date.now() - CONVERSATION_OPEN_DAYS * 86_400_000).toISOString();
      const { data: staleBookings } = await admin
        .from("bookings")
        .select("id")
        .in("status", ["completed", "cancelled", "refunded"])
        .lt("end_at", cutoff)
        .limit(1000);

      const ids = (staleBookings ?? []).map((b) => b.id);
      if (ids.length > 0) {
        const { data: closed } = await admin
          .from("conversations")
          .update({ status: "closed", closed_reason: "This lesson finished a while ago" })
          .in("booking_id", ids)
          .eq("status", "open")
          .select("id");
        results.conversationsClosed = closed?.length ?? 0;
      } else {
        results.conversationsClosed = 0;
      }
    } catch (err) {
      results.conversationsClosed = `failed: ${(err as Error).message}`;
    }

    // 2. Expired rate-limit windows. Purely dead weight once the window has
    //    passed; kept for one hour beyond it so a long window is never cut
    //    out from under an in-flight request.
    try {
      const { data: purged } = await admin
        .from("rate_limits")
        .delete()
        .lt("window_started_at", new Date(Date.now() - 3_600_000).toISOString())
        .select("key");
      results.rateLimitRowsPurged = purged?.length ?? 0;
    } catch (err) {
      results.rateLimitRowsPurged = `failed: ${(err as Error).message}`;
    }

    // 3. Deletion requests past their grace period.
    try {
      const anonymized = await anonymizeDueAccounts();
      results.accountsAnonymized = anonymized;
    } catch (err) {
      results.accountsAnonymized = `failed: ${(err as Error).message}`;
    }

    return results;
  });
}
