import { handle, requireApiUser, apiOk } from "@/lib/api/handler";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The calling TUTOR's own weekly rules and date exceptions. RLS scopes both. */
export async function GET() {
  return handle("GET /api/v1/availability", async () => {
    const auth = await requireApiUser({ roles: ["tutor"] });
    if ("response" in auth) return auth.response;

    const supabase = await createClient();
    const [{ data: rules }, { data: exceptions }] = await Promise.all([
      supabase
        .from("availability_rules")
        .select("day_of_week, start_time, end_time")
        .eq("tutor_id", auth.profile.id)
        .order("day_of_week"),
      supabase
        .from("availability_exceptions")
        .select("date, start_time, end_time, is_available")
        .eq("tutor_id", auth.profile.id)
        // Past exceptions are noise; the tutor cares about what is still ahead.
        .gte("date", new Date().toISOString().slice(0, 10))
        .order("date"),
    ]);

    return apiOk({
      timezone: auth.profile.timezone,
      rules: rules ?? [],
      exceptions: exceptions ?? [],
    });
  });
}
