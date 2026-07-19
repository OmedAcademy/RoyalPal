import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { AvatarUpload } from "@/components/profile/AvatarUpload";
import { StudentProfileForm } from "@/components/profile/StudentProfileForm";
import { getTimezones } from "@/lib/constants/timezones";

export default async function StudentProfilePage() {
  const profile = await requireProfile(["student"]);
  const supabase = await createClient();

  const { data: studentProfile } = await supabase
    .from("student_profiles")
    .select("*")
    .eq("id", profile.id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Your profile</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Keep this up to date so tutors and lesson recommendations fit you better.
        </p>
      </div>

      <AvatarUpload currentAvatarUrl={profile.avatar_url} fullName={profile.full_name} />

      <StudentProfileForm profile={profile} studentProfile={studentProfile} timezones={getTimezones()} />
    </div>
  );
}
