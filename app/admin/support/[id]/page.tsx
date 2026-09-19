import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getTicketForAdmin,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_STYLES,
} from "@/lib/support/service";
import { AdminTicketActions } from "@/components/admin/AdminTicketActions";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Support ticket — RoyalPal Admin" };

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTicketForAdmin(id);
  if (!result) notFound();

  const { ticket, messages } = result;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex items-start gap-3">
        <Link
          href="/admin/support"
          aria-label="Back to the support queue"
          className="text-muted hover:text-foreground shrink-0 pt-1 text-sm"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{ticket.subject}</h1>
          <p className="text-muted text-xs">
            {SUPPORT_CATEGORY_LABELS[ticket.category]} · {ticket.requesterName} (
            {ticket.requesterRole}) · opened {formatDateTime(ticket.createdAt)}
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

      <AdminTicketActions ticketId={ticket.id} currentStatus={ticket.status} />
    </div>
  );
}
