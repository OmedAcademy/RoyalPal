"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { activeUserOrError } from "@/lib/supabase/queries";
import { studentProfileSchema, tutorProfileSchema } from "@/lib/validations/profile";
import { getStringArray, parseLines } from "@/lib/utils/form";

export type ProfileActionState = {
  error?: string;
  message?: string;
};

export async function updateStudentProfile(
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const parsed = studentProfileSchema.safeParse({
    fullName: formData.get("fullName"),
    country: formData.get("country"),
    nativeLanguage: formData.get("nativeLanguage"),
    targetLanguages: getStringArray(formData, "targetLanguages"),
    englishLevel: formData.get("englishLevel"),
    learningGoals: formData.get("learningGoals"),
    timezone: formData.get("timezone"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) {
    return { error: auth.error };
  }
  const user = auth.user;

  const {
    fullName,
    country,
    timezone,
    nativeLanguage,
    targetLanguages,
    englishLevel,
    learningGoals,
  } = parsed.data;

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fullName, country, timezone })
    .eq("id", user.id);

  if (profileError) {
    return { error: profileError.message };
  }

  const { error: studentError } = await supabase
    .from("student_profiles")
    .update({
      native_language: nativeLanguage,
      target_languages: targetLanguages,
      english_level: englishLevel,
      learning_goals: learningGoals,
    })
    .eq("id", user.id);

  if (studentError) {
    return { error: studentError.message };
  }

  revalidatePath("/student/profile");
  revalidatePath("/student/dashboard");

  return { message: "Profile saved" };
}

export async function upsertTutorProfile(
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const parsed = tutorProfileSchema.safeParse({
    fullName: formData.get("fullName"),
    headline: formData.get("headline"),
    bio: formData.get("bio"),
    languagesSpoken: getStringArray(formData, "languagesSpoken"),
    teachingLanguages: getStringArray(formData, "teachingLanguages"),
    specializations: getStringArray(formData, "specializations"),
    yearsExperience: formData.get("yearsExperience"),
    certifications: parseLines(formData.get("certifications")),
    education: formData.get("education"),
    hourlyPrice: formData.get("hourlyPrice"),
    trialPrice: formData.get("trialPrice"),
    availabilityNote: formData.get("availabilityNote"),
    subjectIds: getStringArray(formData, "subjectIds"),
    country: formData.get("country"),
    timezone: formData.get("timezone"),
    videoUrl: formData.get("videoUrl"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) {
    return { error: auth.error };
  }
  const user = auth.user;

  const {
    fullName,
    headline,
    bio,
    languagesSpoken,
    teachingLanguages,
    specializations,
    yearsExperience,
    certifications,
    education,
    hourlyPrice,
    trialPrice,
    availabilityNote,
    subjectIds,
    country,
    timezone,
    videoUrl,
  } = parsed.data;

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fullName, country, timezone })
    .eq("id", user.id);

  if (profileError) {
    return { error: profileError.message };
  }

  const { error: tutorError } = await supabase.from("tutor_profiles").upsert(
    {
      id: user.id,
      headline,
      bio,
      languages_spoken: languagesSpoken,
      teaching_languages: teachingLanguages,
      specializations,
      years_experience: yearsExperience,
      certifications,
      education,
      hourly_rate_cents: Math.round(hourlyPrice * 100),
      trial_price_cents: trialPrice === null ? null : Math.round(trialPrice * 100),
      availability_note: availabilityNote,
      video_url: videoUrl,
    },
    { onConflict: "id" },
  );

  if (tutorError) {
    return { error: tutorError.message };
  }

  const { error: deleteSubjectsError } = await supabase
    .from("tutor_subjects")
    .delete()
    .eq("tutor_id", user.id);

  if (deleteSubjectsError) {
    return { error: deleteSubjectsError.message };
  }

  if (subjectIds.length > 0) {
    const { error: insertSubjectsError } = await supabase
      .from("tutor_subjects")
      .insert(subjectIds.map((subjectId) => ({ tutor_id: user.id, subject_id: subjectId })));

    if (insertSubjectsError) {
      return { error: insertSubjectsError.message };
    }
  }

  revalidatePath("/tutor/profile");
  revalidatePath("/tutor/dashboard");
  revalidatePath("/student/tutors");

  return { message: "Profile saved" };
}
