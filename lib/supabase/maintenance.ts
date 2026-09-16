import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ component: "booking-maintenance" });

/**
 * Lazy booking maintenance.
 *
 * Two housekeeping sweeps keep booking state honest without a scheduler:
 * confirmed lessons whose end_at has passed become 'completed', and
 * pending_payment bookings that outlived their Checkout Session are released.
 *
 * These are platform-wide UPDATEs. Running them inline on every page view
 * (as the first implementation did) meant a write storm and lock contention
 * that scaled with traffic, not with work to be done. They are now:
 *   • throttled — at most once per SWEEP_INTERVAL_MS per server instance, and
 *   • coalesced — concurrent callers share one in-flight sweep,
 * so a thousand simultaneous dashboard loads cause one sweep, not two
 * thousand writes. Behaviour is unchanged; cost is bounded.
 *
 * This is a bridge, not the destination: the real fix is a scheduled job
 * (pg_cron / Vercel Cron) owning these transitions, after which callers can
 * drop the inline call entirely.
 */

const SWEEP_INTERVAL_MS = 60_000;
const PENDING_PAYMENT_GRACE_MINUTES = 45;

let lastSweepAt = 0;
let inFlight: Promise<void> | null = null;

async function sweep(): Promise<void> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const pendingCutoff = new Date(Date.now() - PENDING_PAYMENT_GRACE_MINUTES * 60_000).toISOString();

  // Best-effort: a failure here must never break the page that triggered it.
  const [completed, expired] = await Promise.allSettled([
    admin
      .from("bookings")
      .update({ status: "completed" })
      .eq("status", "confirmed")
      .lt("end_at", nowIso),
    admin
      .from("bookings")
      .update({ status: "cancelled", cancellation_reason: "Payment session expired" })
      .eq("status", "pending_payment")
      .lt("created_at", pendingCutoff),
  ]);

  if (completed.status === "rejected") {
    log.error("completed-booking sweep failed", completed.reason);
  }
  if (expired.status === "rejected") {
    log.error("expired-pending sweep failed", expired.reason);
  }
}

/** Runs the sweeps at most once per interval; concurrent callers share one run. */
export async function runBookingMaintenance(): Promise<void> {
  if (inFlight) return inFlight;
  if (Date.now() - lastSweepAt < SWEEP_INTERVAL_MS) return;

  lastSweepAt = Date.now();
  inFlight = sweep().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
