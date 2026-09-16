import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { AvailabilityEditor } from "@/components/tutor/AvailabilityEditor";

export default async function TutorAvailabilityPage() {
  const profile = await requireProfile(["tutor"]);
  const supabase = await createClient();

  const { data: rules } = await supabase
    .from("availability_rules")
    .select("*")
    .eq("tutor_id", profile.id)
    .order("day_of_week")
    .order("start_time");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Availability</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Students can only book lessons during the hours you set here.
        </p>
      </div>

      <AvailabilityEditor rules={rules ?? []} timezone={profile.timezone} />
    </div>
  );
}
