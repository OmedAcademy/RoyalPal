import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { listConversations } from "@/lib/messaging/service";
import { ConversationList } from "@/components/messaging/ConversationList";

/**
 * Tablet and desktop: the inbox stays beside the open thread. Phones keep
 * the list and the thread as separate screens — the aside is hidden there,
 * and the index page renders the list itself.
 */
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile(["student", "tutor", "admin"]);
  const { conversations, hasMore } = await listConversations(profile.id, { page: 0 });

  return (
    <div className="md:grid md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] md:items-start md:gap-6">
      <aside className="hidden md:block">
        <h2 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Inbox</h2>
        <ConversationList conversations={conversations} timeZone={profile.timezone} />
        {hasMore ? (
          <Link
            href="/messages?page=1"
            className="text-royal mt-3 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          >
            Older conversations
          </Link>
        ) : null}
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
