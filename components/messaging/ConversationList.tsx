"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDateTimeIn, formatRelativeShort } from "@/lib/utils/format";

export type ConversationListItem = {
  id: string;
  counterpartName: string;
  counterpartAvatarUrl: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  subjectName: string | null;
  lessonStartAt: string;
};

export function ConversationList({
  conversations,
  timeZone,
}: {
  conversations: ConversationListItem[];
  timeZone: string;
}) {
  const pathname = usePathname();

  if (conversations.length === 0) {
    return <p className="text-muted text-sm">No conversations yet.</p>;
  }

  return (
    <ul className="border-hairline bg-surface divide-y divide-[color:var(--hairline)] overflow-hidden rounded-2xl border">
      {conversations.map((c) => {
        const href = `/messages/${c.id}`;
        const active = pathname === href;
        return (
          <li key={c.id}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 p-4 transition-colors hover:bg-[color:var(--hairline)]/40 ${
                active ? "bg-[color:var(--hairline)]/60" : ""
              }`}
            >
              <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-[color:var(--hairline)]">
                {c.counterpartAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.counterpartAvatarUrl} alt="" className="h-full w-full object-cover" />
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
                      {c.subjectName ?? "Lesson"} · {formatDateTimeIn(c.lessonStartAt, timeZone)}
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
        );
      })}
    </ul>
  );
}
