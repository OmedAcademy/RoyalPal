import { handle, requireApiUser, apiOk } from "@/lib/api/handler";
import { createClient } from "@/lib/supabase/server";
import { LANGUAGE_SELECT_OPTIONS } from "@/lib/constants/languages";
import { COUNTRY_SELECT_OPTIONS } from "@/lib/constants/countries";
import {
  ENGLISH_LEVELS,
  ENGLISH_LEVEL_LABELS,
  SPECIALIZATIONS,
} from "@/lib/constants/profile-options";
import { getTimezones } from "@/lib/constants/timezones";

export const dynamic = "force-dynamic";

/**
 * The option lists a profile editor needs: languages, countries, timezones,
 * English levels, specializations and the live subject catalogue.
 *
 * Served rather than bundled into the app on purpose. Subjects are rows in the
 * database and change without an app release, and the ISO language and country
 * datasets are large enough that shipping a second copy in the binary would
 * bloat it for data the server already holds. A phone that pinned its own copy
 * would also start offering subjects that no longer exist, and the booking
 * would fail at the foreign key with nothing useful to say.
 */
export async function GET() {
  return handle("GET /api/v1/reference", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    const supabase = await createClient();
    const { data: subjects } = await supabase
      .from("subjects")
      .select("id, name, category")
      .order("category")
      .order("name");

    return apiOk({
      // The same option lists, in the same order, that the web forms render —
      // and the stored value is the canonical NAME, which is what validation
      // checks membership against. Serving codes here would mean the phone
      // posting values every profile schema rejects.
      languages: LANGUAGE_SELECT_OPTIONS,
      countries: COUNTRY_SELECT_OPTIONS,
      timezones: getTimezones(),
      englishLevels: ENGLISH_LEVELS.map((level) => ({
        value: level,
        label: ENGLISH_LEVEL_LABELS[level],
      })),
      specializations: SPECIALIZATIONS,
      subjects: subjects ?? [],
    });
  });
}
