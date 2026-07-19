import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { SignOutButton } from "@/components/auth/SignOutButton";

export default async function TutorLayout({ children }: { children: React.ReactNode }) {
  await requireProfile(["tutor"]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-4 dark:border-white/10">
        <span className="font-semibold">RoyalPal · Tutor</span>
        <nav className="flex items-center gap-4">
          <Link href="/tutor/dashboard" className="text-sm font-medium">
            Dashboard
          </Link>
          <Link href="/tutor/profile" className="text-sm font-medium">
            Profile
          </Link>
          <SignOutButton />
        </nav>
      </header>
      <main className="flex flex-1 flex-col px-6 py-8">{children}</main>
    </div>
  );
}
