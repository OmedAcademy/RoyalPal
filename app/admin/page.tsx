import { requireProfile } from "@/lib/supabase/queries";

export default async function AdminPage() {
  const profile = await requireProfile(["admin"]);

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">Welcome, {profile.full_name}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        User management, booking oversight, and tutor verification land in M15.
      </p>
    </div>
  );
}
