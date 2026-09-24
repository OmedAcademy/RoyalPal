import Link from "next/link";
import type { Metadata } from "next";
import { requireProfile } from "@/lib/supabase/queries";
import { listConversations } from "@/lib/messaging/service";
import { SearchPagination } from "@/components/tutor/SearchPagination";
import { ConversationList } from "@/components/messaging/ConversationList";

export const metadata: Metadata = { title: "Messages — RoyalPal" };

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const profile = await requireProfile(["student", "tutor", "admin"]);
  const { page: pageParam } = await searchParams;
  const requestedPage = Number.parseInt(pageParam ?? "0", 10);
  const { conversations, page, pageSize, total, hasMore } = await listConversations(profile.id, {
    page: Number.isNaN(requestedPage) ? 0 : requestedPage,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Messages</h1>
        <p className="text-muted mt-1 text-sm">
          A thread opens for every lesson you book, so you and your{" "}
          {profile.role === "tutor" ? "student" : "tutor"} can sort out the details.
        </p>
      </div>

      {conversations.length === 0 && page === 0 ? (
        <div className="border-hairline bg-surface flex flex-col gap-2 rounded-2xl border p-6">
          <p className="font-medium">No conversations yet.</p>
          <p className="text-muted text-sm">
            {profile.role === "tutor"
              ? "When a student books a lesson with you, your thread with them appears here."
              : "Book a lesson and a thread with your tutor opens automatically."}
          </p>
          {profile.role === "student" && (
            <Link
              href="/student/tutors"
              className="text-royal mt-1 text-sm font-medium underline underline-offset-4"
            >
              Find a tutor
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="md:hidden">
            <ConversationList conversations={conversations} timeZone={profile.timezone} />
            <SearchPagination
              page={page}
              hasMore={hasMore}
              total={total}
              pageSize={pageSize}
              label="Conversation pages"
            />
          </div>
          <div className="border-hairline bg-surface hidden flex-col gap-2 rounded-2xl border p-6 md:flex">
            <p className="font-medium">
              {page > 0 ? "Older conversations" : "Choose a conversation"}
            </p>
            <p className="text-muted text-sm">
              {page > 0
                ? "These threads are older than the ones in the inbox. Open one to read it."
                : "The latest threads are listed beside this panel. Open one to read it here."}
            </p>
            {page > 0 ? (
              <div className="mt-2">
                <ConversationList conversations={conversations} timeZone={profile.timezone} />
                <SearchPagination
                  page={page}
                  hasMore={hasMore}
                  total={total}
                  pageSize={pageSize}
                  label="Conversation pages"
                />
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
