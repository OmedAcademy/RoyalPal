import "server-only";
import { advanceLessonLifecycle } from "@/lib/booking/lifecycle";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

const log = logger.child({ component: "booking-maintenance" });

/**
 * Runs the lesson clock on a request that is about to show or take a slot.
 *
 * Failures are logged and swallowed here on purpose. A sweep that cannot
 * reach the database must not take the bookings page down with it; the cron
 * route does not swallow, so a broken job is still visible there.
 */
export async function runBookingMaintenance(): Promise<void> {
  try {
    await advanceLessonLifecycle(createAdminClient());
  } catch (err) {
    log.error("lesson lifecycle sweep failed", err);
  }
}
