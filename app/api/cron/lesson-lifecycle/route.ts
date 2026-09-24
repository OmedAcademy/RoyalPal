import { NextResponse } from "next/server";
import { advanceLessonLifecycle } from "@/lib/booking/lifecycle";
import { authorizeCron, runJob } from "@/lib/cron/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Daily backstop for the lesson clock. The same transitions also run on
 * booking reads and writes (lib/supabase/maintenance.ts), because a Hobby
 * cron can fire only once a day and a 45-minute unpaid hold cannot wait
 * that long. This job is what still completes lessons on a day nobody
 * opens the app, which is what makes reviews possible the next morning.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = authorizeCron(request);
  if (denied) return denied;

  return runJob("lesson-lifecycle", () => advanceLessonLifecycle(createAdminClient()));
}
