import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { computeStudentProfileCompletion } from "@/lib/utils/profile-completion";

export default async function StudentDashboardPage() {
  const profile = await requireProfile(["student"]);
  const supabase = await createClient();

  const { data: studentProfile } = await supabase
    .from("student_profiles")
    .select("*")
    .eq("id", profile.id)
    .maybeSingle();

  const completion = computeStudentProfileCompletion(profile, studentProfile);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Welcome, {profile.full_name}</h1>

      <div className="flex max-w-sm flex-col gap-2 rounded-md border border-black/10 p-4 dark:border-white/10">
        <ProgressBar percentage={completion} label="Profile completion" />
        <Link href="/student/profile" className="w-fit text-sm font-medium underline underline-offset-2">
          {completion < 100 ? "Complete your profile" : "Edit your profile"}
        </Link>
      </div>

      <Link href="/student/tutors" className="w-fit text-sm font-medium underline underline-offset-2">
        Find a tutor
      </Link>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">Your bookings will show up here starting M5.</p>
    </div>
  );
}
