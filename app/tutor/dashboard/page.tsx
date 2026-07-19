import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { computeTutorProfileCompletion } from "@/lib/utils/profile-completion";

export default async function TutorDashboardPage() {
  const profile = await requireProfile(["tutor"]);
  const supabase = await createClient();

  const { data: tutorProfile } = await supabase
    .from("tutor_profiles")
    .select("*")
    .eq("id", profile.id)
    .maybeSingle();

  const completion = computeTutorProfileCompletion(profile, tutorProfile);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Welcome, {profile.full_name}</h1>

      <div className="flex max-w-sm flex-col gap-2 rounded-md border border-black/10 p-4 dark:border-white/10">
        <ProgressBar percentage={completion} label="Profile completion" />
        <Link href="/tutor/profile" className="w-fit text-sm font-medium underline underline-offset-2">
          {completion < 100 ? "Complete your profile" : "Edit your profile"}
        </Link>
      </div>

      {tutorProfile ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Verification status: <span className="font-medium">{tutorProfile.verification_status}</span>
        </p>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Set up your profile so an admin can review and approve you.
        </p>
      )}
    </div>
  );
}
