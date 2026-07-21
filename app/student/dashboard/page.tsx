import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { computeStudentProfileCompletion } from "@/lib/utils/profile-completion";
import { getBookingsFor } from "@/lib/supabase/bookings";

export default async function StudentDashboardPage() {
  const profile = await requireProfile(["student"]);
  const supabase = await createClient();

  const { data: studentProfile } = await supabase
    .from("student_profiles")
    .select("*")
    .eq("id", profile.id)
    .maybeSingle();

  const completion = computeStudentProfileCompletion(profile, studentProfile);
  const bookings = await getBookingsFor(profile.id, "student");
  const upcomingCount = bookings.filter(
    (b) => b.status === "pending_payment" || b.status === "confirmed",
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Welcome, {profile.full_name}</h1>

      <div className="flex max-w-sm flex-col gap-2 rounded-md border border-black/10 p-4 dark:border-white/10">
        <ProgressBar percentage={completion} label="Profile completion" />
        <Link
          href="/student/profile"
          className="w-fit text-sm font-medium underline underline-offset-2"
        >
          {completion < 100 ? "Complete your profile" : "Edit your profile"}
        </Link>
      </div>

      <div className="flex gap-4">
        <Link
          href="/student/tutors"
          className="w-fit text-sm font-medium underline underline-offset-2"
        >
          Find a tutor
        </Link>
        <Link
          href="/student/bookings"
          className="w-fit text-sm font-medium underline underline-offset-2"
        >
          {upcomingCount > 0
            ? `${upcomingCount} upcoming lesson${upcomingCount === 1 ? "" : "s"}`
            : "Your bookings"}
        </Link>
      </div>
    </div>
  );
}
