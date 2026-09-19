import {
  handle,
  requireApiUser,
  apiOk,
  apiError,
  invokeAction,
  actionResponse,
} from "@/lib/api/handler";
import { createClient } from "@/lib/supabase/server";
import { updateAvailabilityRules } from "@/lib/actions/availability";

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

/**
 * Replaces the whole weekly template in one call.
 *
 * Replacement, not a diff, matching updateAvailabilityRules — which is the
 * safer shape for a mobile client: a phone that loses connection halfway
 * through a sequence of per-row edits leaves a calendar nobody intended, while
 * a single replace either happened or did not.
 *
 * An empty list is a legitimate request ("I am not available at all"), so it
 * has to survive the trip. FormData.getAll() cannot distinguish an empty list
 * from an absent field, which is why invokeAction marks it.
 */
export async function PUT(request: Request) {
  return handle("PUT /api/v1/availability", async () => {
    const auth = await requireApiUser({ roles: ["tutor"] });
    if ("response" in auth) return auth.response;

    const body = (await request.json().catch(() => null)) as {
      rules?: { dayOfWeek: number; startTime: string; endTime: string }[];
    } | null;

    if (!body || !Array.isArray(body.rules)) {
      return apiError("Send a `rules` array", 400, "bad_request");
    }

    const result = await invokeAction(
      updateAvailabilityRules,
      {
        dayOfWeek: body.rules.map((rule) => rule.dayOfWeek),
        startTime: body.rules.map((rule) => rule.startTime),
        endTime: body.rules.map((rule) => rule.endTime),
      },
      {},
    );

    if ("redirectTo" in result) return actionResponse({});
    return actionResponse(result.state);
  });
}
