import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { AvatarUpload } from "@/components/profile/AvatarUpload";
import { TutorProfileForm } from "@/components/profile/TutorProfileForm";
import { getTimezones } from "@/lib/constants/timezones";
import { TUTOR_PROFILE_CLIENT_COLUMNS } from "@/lib/supabase/columns";

export default async function TutorProfilePage() {
  const profile = await requireProfile(["tutor"]);
  const supabase = await createClient();

  const [{ data: tutorProfile }, { data: subjects }, { data: tutorSubjects }] = await Promise.all([
    supabase
      .from("tutor_profiles")
      .select(TUTOR_PROFILE_CLIENT_COLUMNS)
      .eq("id", profile.id)
      .maybeSingle(),
    supabase.from("subjects").select("*").order("category").order("name"),
    supabase.from("tutor_subjects").select("subject_id").eq("tutor_id", profile.id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Your profile</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This is what students see when deciding whether to book a lesson with you.
        </p>
      </div>

      <AvatarUpload currentAvatarUrl={profile.avatar_url} fullName={profile.full_name} />

      <TutorProfileForm
        profile={profile}
        tutorProfile={tutorProfile}
        timezones={getTimezones()}
        subjects={subjects ?? []}
        selectedSubjectIds={(tutorSubjects ?? []).map((row) => row.subject_id)}
      />
    </div>
  );
}
