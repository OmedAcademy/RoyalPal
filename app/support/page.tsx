import Link from "next/link";
import type { Metadata } from "next";
import {
  listMyTickets,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_STYLES,
  SUPPORT_CATEGORY_LABELS,
} from "@/lib/support/service";
import { NewTicketForm } from "@/components/support/NewTicketForm";
import { formatRelativeShort } from "@/lib/utils/format";
import { LEGAL_ROUTES } from "@/lib/constants/legal";

export const metadata: Metadata = { title: "Support — RoyalPal" };

export default async function SupportPage() {
  const tickets = await listMyTickets();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Support</h1>
        <p className="text-muted mt-1 text-sm">
          Tell us what&apos;s going on and we&apos;ll pick it up. You&apos;ll get a notification
          when we reply.
        </p>
      </div>

      {tickets.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Your requests</h2>
          <ul className="border-hairline bg-surface divide-y divide-[color:var(--hairline)] overflow-hidden rounded-2xl border">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`/support/${ticket.id}`}
                  className="flex items-center gap-3 p-4 transition-colors hover:bg-[color:var(--hairline)]/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{ticket.subject}</p>
                    <p className="text-muted truncate text-sm">
                      {SUPPORT_CATEGORY_LABELS[ticket.category]} ·{" "}
                      {formatRelativeShort(ticket.lastMessageAt)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SUPPORT_STATUS_STYLES[ticket.status]}`}
                  >
                    {SUPPORT_STATUS_LABELS[ticket.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">
          {tickets.length > 0 ? "Open another request" : "Open a request"}
        </h2>
        <NewTicketForm />
      </section>

      <p className="text-muted text-xs">
        If someone is in immediate danger, contact your local emergency services — RoyalPal support
        is not an emergency service. See our{" "}
        <Link href={LEGAL_ROUTES.safeguarding} className="underline underline-offset-2">
          safeguarding policy
        </Link>
        .
      </p>
    </div>
  );
}
