import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { AdminNav } from "@/components/admin/AdminNav";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { NotificationService } from "@/lib/notifications/service";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireProfile(["admin"]);
  const [notifications, unreadCount] = await Promise.all([
    NotificationService.list(),
    NotificationService.unreadCount(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-hairline bg-surface border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/admin" className="font-display text-lg font-semibold tracking-tight">
            Royal<span className="text-royal">Pal</span> <span className="text-muted">Admin</span>
          </Link>
          <div className="flex items-center gap-2">
            <NotificationCenter notifications={notifications} unreadCount={unreadCount} />
            <SignOutButton />
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl px-5 pb-3 sm:px-8">
          <AdminNav />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">{children}</main>
    </div>
  );
}
