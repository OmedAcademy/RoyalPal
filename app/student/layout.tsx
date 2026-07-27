import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { NotificationService } from "@/lib/notifications/service";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  await requireProfile(["student"]);
  const [notifications, unreadCount] = await Promise.all([
    NotificationService.list(),
    NotificationService.unreadCount(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-hairline bg-surface flex items-center justify-between border-b px-6 py-4">
        <span className="font-display font-semibold tracking-tight">
          Royal<span className="text-royal">Pal</span> <span className="text-muted">Student</span>
        </span>
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
          <NotificationCenter notifications={notifications} unreadCount={unreadCount} />
          <SignOutButton />
        </nav>
      </header>
      <main className="flex flex-1 flex-col px-6 py-8">{children}</main>
    </div>
  );
}
