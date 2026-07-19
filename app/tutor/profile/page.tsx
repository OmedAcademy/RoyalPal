import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { AvatarUpload } from "@/components/profile/AvatarUpload";
import { TutorProfileForm } from "@/components/profile/TutorProfileForm";
import { getTimezones } from "@/lib/constants/timezones";

export default async function TutorProfilePage() {
  const profile = await requireProfile(["tutor"]);
  const supabase = await createClient();

  const { data: tutorProfile } = await supabase
    .from("tutor_profiles")
    .select("*")
    .eq("id", profile.id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Your profile</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This is what students see when deciding whether to book a lesson with you.
        </p>
      </div>

      <AvatarUpload currentAvatarUrl={profile.avatar_url} fullName={profile.full_name} />

      <TutorProfileForm profile={profile} tutorProfile={tutorProfile} timezones={getTimezones()} />
    </div>
  );
}
