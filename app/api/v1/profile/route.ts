import { handle, requireApiUser, apiOk, invokeAction, actionResponse } from "@/lib/api/handler";
import { createClient } from "@/lib/supabase/server";
import { updateStudentProfile, upsertTutorProfile } from "@/lib/actions/profile";

export const dynamic = "force-dynamic";

/** The caller's own profile, in the shape the edit form needs to prefill. */
export async function GET() {
  return handle("GET /api/v1/profile", async () => {
    const auth = await requireApiUser();
    if ("response" in auth) return auth.response;

    const supabase = await createClient();
    const isTutor = auth.profile.role === "tutor";

    const [roleProfile, subjectIds] = await Promise.all([
      isTutor
        ? supabase
            .from("tutor_profiles")
            // Only the columns the form edits. The Stripe and moderation
            // columns on this row are the tutor's own to read, but they are
            // not this endpoint's business and have no place in a phone's
            // memory or its crash reports.
            .select(
              "headline, bio, video_url, hourly_rate_cents, trial_price_cents, currency, languages_spoken, teaching_languages, specializations, years_experience, certifications, education, availability_note",
            )
            .eq("id", auth.profile.id)
            .maybeSingle()
        : supabase
            .from("student_profiles")
            .select("learning_goals, target_languages, native_language, english_level")
            .eq("id", auth.profile.id)
            .maybeSingle(),
      isTutor
        ? supabase.from("tutor_subjects").select("subject_id").eq("tutor_id", auth.profile.id)
        : Promise.resolve({ data: [] as { subject_id: number }[] }),
    ]);

    return apiOk({
      role: auth.profile.role,
      profile: {
        fullName: auth.profile.full_name,
        country: auth.profile.country,
        timezone: auth.profile.timezone,
        avatarUrl: auth.profile.avatar_url,
      },
      roleProfile: roleProfile.data ?? null,
      subjectIds: (subjectIds.data ?? []).map((row) => row.subject_id),
    });
  });
}

/**
 * Updates it, through the same Server Action the web form posts to — so the
 * validation, the write allowlist (pinned by lib/actions/profile.test.ts) and
 * the privileged-column locks are one implementation, not two.
 *
 * Which action runs is decided by the caller's ROLE, read from their own
 * profile row, never from the request body. A student POSTing a tutor payload
 * gets the student action.
 */
export async function PUT(request: Request) {
  return handle("PUT /api/v1/profile", async () => {
    const auth = await requireApiUser({ roles: ["student", "tutor"] });
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as Record<string, unknown>;
    const str = (key: string) =>
      typeof body[key] === "string" ? (body[key] as string) : undefined;
    const list = (key: string) => (Array.isArray(body[key]) ? (body[key] as string[]) : undefined);

    if (auth.profile.role === "tutor") {
      const result = await invokeAction(
        upsertTutorProfile,
        {
          fullName: str("fullName"),
          headline: str("headline"),
          bio: str("bio"),
          languagesSpoken: list("languagesSpoken"),
          teachingLanguages: list("teachingLanguages"),
          specializations: list("specializations"),
          yearsExperience: str("yearsExperience") ?? "",
          // The action parses these as newline-separated lines, matching the
          // textarea the web form uses.
          certifications: (list("certifications") ?? []).join("\n"),
          education: str("education"),
          hourlyPrice: str("hourlyPrice"),
          trialPrice: str("trialPrice") ?? "",
          availabilityNote: str("availabilityNote"),
          videoUrl: str("videoUrl") ?? "",
          subjectIds: (body.subjectIds as number[] | undefined)?.map(String),
          country: str("country"),
          timezone: str("timezone"),
        },
        {},
      );
      if ("redirectTo" in result) return actionResponse({});
      return actionResponse(result.state);
    }

    const result = await invokeAction(
      updateStudentProfile,
      {
        fullName: str("fullName"),
        country: str("country"),
        nativeLanguage: str("nativeLanguage") ?? "",
        targetLanguages: list("targetLanguages"),
        englishLevel: str("englishLevel") ?? "",
        learningGoals: str("learningGoals"),
        timezone: str("timezone"),
      },
      {},
    );
    if ("redirectTo" in result) return actionResponse({});
    return actionResponse(result.state);
  });
}
