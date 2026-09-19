import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getTicket,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_STYLES,
} from "@/lib/support/service";
import { TicketReplyForm } from "@/components/support/TicketReplyForm";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Support request — RoyalPal" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTicket(id);
  // RLS makes "someone else's ticket" and "no such ticket" the same answer,
  // and so does this.
  if (!result) notFound();

  const { ticket, messages } = result;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex items-start gap-3">
        <Link
          href="/support"
          aria-label="Back to support"
          className="text-muted hover:text-foreground shrink-0 pt-1 text-sm"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{ticket.subject}</h1>
          <p className="text-muted text-xs">
            {SUPPORT_CATEGORY_LABELS[ticket.category]} · opened {formatDateTime(ticket.createdAt)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SUPPORT_STATUS_STYLES[ticket.status]}`}
        >
          {SUPPORT_STATUS_LABELS[ticket.status]}
        </span>
      </div>

      <ol className="flex flex-col gap-3">
        {messages.map((m) => (
          <li
            key={m.id}
            className={`border-hairline rounded-2xl border p-4 ${
              m.fromAdmin ? "bg-[color:var(--hairline)]/40" : "bg-surface"
            }`}
          >
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{m.senderName}</span>
              <span className="text-muted text-xs">{formatDateTime(m.createdAt)}</span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>

      {ticket.status === "closed" ? (
        <p
          role="status"
          className="border-hairline text-muted rounded-xl border border-dashed px-4 py-3 text-sm"
        >
          This request is closed. Open a new one if you still need help.
        </p>
      ) : (
        <TicketReplyForm ticketId={ticket.id} />
      )}
    </div>
  );
}
