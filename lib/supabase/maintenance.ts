import "server-only";

/**
 * DELIBERATELY EMPTY. The booking maintenance sweep now runs as a scheduled
 * job: app/api/cron/lesson-lifecycle.
 *
 * What was here ran platform-wide UPDATEs whenever somebody happened to load a
 * bookings page, throttled by a module-level variable. On Vercel that variable
 * is per-lambda-instance, so the throttle enforced nothing under load and the
 * sweep did not run at all when traffic was quiet. Since reviews require a
 * completed lesson, "nobody visited this weekend" silently meant "nobody can
 * review".
 *
 * This shim stays so the call site keeps compiling while the cron beds in, and
 * so anyone who goes looking for the old behaviour finds this explanation
 * rather than a deleted file. It should be removed along with its one caller
 * in lib/supabase/bookings.ts once the schedule is confirmed running in
 * production.
 */
export async function runBookingMaintenance(): Promise<void> {
  // Intentionally a no-op.
}
