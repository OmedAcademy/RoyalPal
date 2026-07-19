import type { Profile, StudentProfile, TutorProfile } from "@/types/database";

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function percentage(filledCount: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((filledCount / total) * 100);
}

/** full_name is guaranteed at signup and avatar/timezone have defaults, so
 * they're excluded — completion should reflect fields the user still has
 * to actively fill in. */
export function computeStudentProfileCompletion(
  profile: Profile,
  studentProfile: StudentProfile | null,
): number {
  const fields = [
    isFilled(profile.avatar_url),
    isFilled(profile.country),
    isFilled(studentProfile?.native_language),
    isFilled(studentProfile?.target_languages),
    isFilled(studentProfile?.english_level),
    isFilled(studentProfile?.learning_goals),
  ];

  return percentage(fields.filter(Boolean).length, fields.length);
}

export function computeTutorProfileCompletion(
  profile: Profile,
  tutorProfile: TutorProfile | null,
): number {
  if (!tutorProfile) return 0;

  const fields = [
    isFilled(profile.avatar_url),
    isFilled(profile.country),
    isFilled(tutorProfile.headline),
    isFilled(tutorProfile.bio),
    isFilled(tutorProfile.languages_spoken),
    isFilled(tutorProfile.teaching_languages),
    isFilled(tutorProfile.specializations),
    isFilled(tutorProfile.years_experience),
    isFilled(tutorProfile.certifications),
    isFilled(tutorProfile.education),
    isFilled(tutorProfile.hourly_rate_cents),
    isFilled(tutorProfile.trial_price_cents),
    isFilled(tutorProfile.availability_note),
    isFilled(tutorProfile.video_url),
  ];

  return percentage(fields.filter(Boolean).length, fields.length);
}
