import Link from "next/link";
import type { Metadata } from "next";
import { requireProfile } from "@/lib/supabase/queries";
import { listConversations } from "@/lib/messaging/service";
import { formatRelativeShort, formatDateTimeIn } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Messages — RoyalPal" };

export default async function MessagesPage() {
  const profile = await requireProfile(["student", "tutor", "admin"]);
  const conversations = await listConversations(profile.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Messages</h1>
        <p className="text-muted mt-1 text-sm">
          A thread opens for every lesson you book, so you and your{" "}
          {profile.role === "tutor" ? "student" : "tutor"} can sort out the details.
        </p>
      </div>

      {conversations.length === 0 ? (
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
        <ul className="border-hairline bg-surface divide-y divide-[color:var(--hairline)] overflow-hidden rounded-2xl border">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/messages/${c.id}`}
                className="flex items-center gap-3 p-4 transition-colors hover:bg-[color:var(--hairline)]/40"
              >
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-[color:var(--hairline)]">
                  {c.counterpartAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.counterpartAvatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="text-muted flex h-full w-full items-center justify-center font-semibold"
                    >
                      {c.counterpartName.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate font-medium">{c.counterpartName}</p>
                    {c.lastMessageAt && (
                      <span className="text-muted shrink-0 text-xs">
                        {formatRelativeShort(c.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <p className="text-muted truncate text-sm">
                    {c.lastMessagePreview ?? (
                      <span className="italic">
                        {c.subjectName ?? "Lesson"} ·{" "}
                        {formatDateTimeIn(c.lessonStartAt, profile.timezone)}
                      </span>
                    )}
                  </p>
                </div>

                {c.unreadCount > 0 && (
                  <span className="bg-royal text-royal-contrast ml-1 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold">
                    {c.unreadCount > 9 ? "9+" : c.unreadCount}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
