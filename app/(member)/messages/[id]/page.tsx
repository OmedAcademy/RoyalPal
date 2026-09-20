import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireProfile } from "@/lib/supabase/queries";
import { getConversation, markConversationRead } from "@/lib/messaging/service";
import { MessageComposer } from "@/components/messaging/MessageComposer";
import { formatDateTimeIn, formatTimeIn, timeZoneLabel } from "@/lib/utils/format";
import { BOOKING_STATUS_LABELS } from "@/lib/utils/booking-status";
import type { BookingStatus } from "@/types/database";

export const metadata: Metadata = { title: "Conversation — RoyalPal" };

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const profile = await requireProfile(["student", "tutor", "admin"]);
  const { id } = await params;
  const { before } = await searchParams;

  const result = await getConversation(id, profile.id, { before });
  // The conversation row is RLS-scoped, so "not yours" and "does not exist"
  // are the same 404 rather than two different answers a prober could tell
  // apart.
  if (!result) notFound();

  const { conversation, messages, hasMore, nextCursor } = result;

  // Only the newest page marks the thread read. Reading back through history
  // is not the same as having seen what arrived while you were down there, and
  // a read receipt that fires on the wrong page tells the other person
  // something untrue.
  const viewingLatest = !before;
  if (viewingLatest) await markConversationRead(id, profile.id);

  const tz = profile.timezone;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <Link
          href="/messages"
          aria-label="Back to messages"
          className="text-muted hover:text-foreground shrink-0 text-sm"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{conversation.counterpartName}</h1>
          <p className="text-muted truncate text-xs">
            {conversation.subjectName ?? "Lesson"} ·{" "}
            {formatDateTimeIn(conversation.lessonStartAt, tz)} (
            {timeZoneLabel(conversation.lessonStartAt, tz)}) ·{" "}
            {BOOKING_STATUS_LABELS[conversation.lessonStatus as BookingStatus] ??
              conversation.lessonStatus}
          </p>
        </div>
      </div>

      {!viewingLatest && (
        <p
          role="status"
          className="border-hairline text-muted flex items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-2.5 text-sm"
        >
          <span>You&apos;re reading earlier messages.</span>
          <Link href={`/messages/${id}`} className="font-medium underline underline-offset-4">
            Go to latest
          </Link>
        </p>
      )}

      <div className="border-hairline bg-surface flex flex-col gap-3 rounded-2xl border p-4">
        {hasMore && nextCursor && (
          <Link
            href={`/messages/${id}?before=${encodeURIComponent(nextCursor)}`}
            rel="prev"
            className="text-muted hover:text-foreground self-center text-sm underline underline-offset-4"
          >
            Load earlier messages
          </Link>
        )}

        {messages.length === 0 ? (
          <p className="text-muted py-6 text-center text-sm">
            No messages yet. Say hello and agree what you&apos;d like to cover.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {messages.map((m) => (
              <li key={m.id} className={`flex flex-col ${m.mine ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                    m.mine
                      ? "bg-royal text-royal-contrast rounded-br-sm"
                      : "rounded-bl-sm bg-[color:var(--hairline)]"
                  }`}
                >
                  {m.body}
                </div>
                <span className="text-muted mt-0.5 text-[11px]">
                  {formatTimeIn(m.createdAt, tz)}
                  {m.mine && m.readAt ? " · Read" : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {!viewingLatest ? (
        <p className="text-muted text-sm">
          <Link href={`/messages/${id}`} className="underline underline-offset-4">
            Return to the latest messages
          </Link>{" "}
          to reply.
        </p>
      ) : conversation.status === "closed" ? (
        <p
          role="status"
          className="border-hairline text-muted rounded-xl border border-dashed px-4 py-3 text-sm"
        >
          This conversation is closed
          {conversation.closedReason ? ` — ${conversation.closedReason}` : ""}. You can still read
          it, but no new messages can be sent.
        </p>
      ) : (
        <MessageComposer conversationId={conversation.id} />
      )}

      <p className="text-muted text-xs">
        Keep conversations on RoyalPal. Messages are retained and may be reviewed by our team if
        something is reported.{" "}
        <Link href="/legal/acceptable-use" className="underline underline-offset-2">
          Acceptable use
        </Link>
      </p>
    </div>
  );
}
