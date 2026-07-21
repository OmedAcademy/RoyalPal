import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { SignOutButton } from "@/components/auth/SignOutButton";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  await requireProfile(["student"]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-4 dark:border-white/10">
        <span className="font-semibold">RoyalPal · Student</span>
        <nav className="flex items-center gap-4">
          <Link href="/student/dashboard" className="text-sm font-medium">
            Dashboard
          </Link>
          <Link href="/student/tutors" className="text-sm font-medium">
            Find a tutor
          </Link>
          <Link href="/student/bookings" className="text-sm font-medium">
            Bookings
          </Link>
          <Link href="/student/profile" className="text-sm font-medium">
            Profile
          </Link>
          <SignOutButton />
        </nav>
      </header>
      <main className="flex flex-1 flex-col px-6 py-8">{children}</main>
    </div>
  );
}
