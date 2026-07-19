import { requireProfile } from "@/lib/supabase/queries";
import { SignOutButton } from "@/components/auth/SignOutButton";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireProfile(["admin"]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-4 dark:border-white/10">
        <span className="font-semibold">RoyalPal · Admin</span>
        <SignOutButton />
      </header>
      <main className="flex flex-1 flex-col px-6 py-8">{children}</main>
    </div>
  );
}
