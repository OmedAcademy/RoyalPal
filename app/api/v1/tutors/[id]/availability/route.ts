import { handle, requireApiUser, apiOk } from "@/lib/api/handler";
import { getTutorAvailableSlots } from "@/lib/supabase/availability";
import { createClient } from "@/lib/supabase/server";
import { utcToZonedParts } from "@/lib/utils/timezone";
import { formatDateIn, formatTimeIn } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

/**
 * Open slots, grouped by day IN THE CALLER'S OWN TIME ZONE.
 *
 * The grouping is done here rather than in the app for a reason worth stating:
 * a phone's clock and locale are set by its owner and can be wrong, changed
 * mid-flight, or simply different from the account's stored zone. Deriving day
 * boundaries on the device would let two students see different days for the
 * same slot. The server owns the calendar; the app renders it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle("GET /api/v1/tutors/[id]/availability", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const url = new URL(request.url);
    const duration = url.searchParams.get("durationMinutes") === "30" ? 30 : 60;

    const supabase = await createClient();
    const { data: tutorAccount } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", id)
      .maybeSingle();

    const slots = await getTutorAvailableSlots({
      tutorId: id,
      timeZone: tutorAccount?.timezone ?? "UTC",
      durationMinutes: duration,
    });

    const viewerZone = auth.profile.timezone;
    const groups = new Map<string, { date: string; label: string; slots: unknown[] }>();

    for (const slot of slots) {
      const { date } = utcToZonedParts(slot.startAt, viewerZone);
      if (!groups.has(date)) {
        groups.set(date, { date, label: formatDateIn(slot.startAt, viewerZone), slots: [] });
      }
      groups.get(date)!.slots.push({
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
        label: formatTimeIn(slot.startAt, viewerZone),
      });
    }

    return apiOk({ timezone: viewerZone, durationMinutes: duration, days: [...groups.values()] });
  });
}
