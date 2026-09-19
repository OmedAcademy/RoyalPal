import Link from "next/link";
import type { Metadata } from "next";
import {
  listAllTickets,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_STYLES,
  URGENT_CATEGORIES,
} from "@/lib/support/service";
import { AdminTable, Th, Td } from "@/components/admin/AdminTable";
import { formatDateTime } from "@/lib/utils/format";
import type { SupportCategory, SupportStatus } from "@/types/database";

export const metadata: Metadata = { title: "Support queue — RoyalPal Admin" };

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Open", value: "open" },
  { label: "In progress", value: "in_progress" },
  { label: "Waiting on user", value: "waiting_on_user" },
  { label: "Resolved", value: "resolved" },
  { label: "Closed", value: "closed" },
];

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const validStatus = STATUS_FILTERS.map((f) => f.value).includes(status ?? "")
    ? (status as SupportStatus | undefined)
    : undefined;

  const tickets = await listAllTickets({ status: validStatus || undefined });

  // Urgent categories are lifted out of the ordinary queue rather than being
  // sorted within it. A safeguarding report is not a support request with a
  // longer SLA; a delay there is the harm.
  const urgent = tickets.filter(
    (t) =>
      URGENT_CATEGORIES.includes(t.category as SupportCategory) &&
      t.status !== "resolved" &&
      t.status !== "closed",
  );
  const rest = tickets.filter((t) => !urgent.includes(t));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Support queue
        </h1>
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={f.value ? `/admin/support?status=${f.value}` : "/admin/support"}
              aria-current={(validStatus ?? "") === f.value ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                (validStatus ?? "") === f.value
                  ? "text-foreground bg-[color:var(--hairline)]"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </div>

      {urgent.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-red-700 dark:text-red-400">
            Needs attention now ({urgent.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {urgent.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/admin/support/${t.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-4 transition-colors hover:border-red-500/60"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.subject}</p>
                    <p className="text-muted truncate text-sm">
                      {SUPPORT_CATEGORY_LABELS[t.category]} · {t.requesterName} ({t.requesterRole})
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-red-700 dark:text-red-400">
                    {formatDateTime(t.lastMessageAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AdminTable
        isEmpty={rest.length === 0}
        empty="No tickets match this view."
        head={
          <>
            <Th>Subject</Th>
            <Th>Requester</Th>
            <Th>Category</Th>
            <Th>Status</Th>
            <Th>Last activity</Th>
          </>
        }
      >
        {rest.map((t) => (
          <tr key={t.id}>
            <Td className="font-medium">
              <Link href={`/admin/support/${t.id}`} className="hover:underline">
                {t.subject}
              </Link>
            </Td>
            <Td className="text-muted">
              {t.requesterName}
              <span className="text-muted"> ({t.requesterRole})</span>
            </Td>
            <Td className="text-muted">{SUPPORT_CATEGORY_LABELS[t.category]}</Td>
            <Td>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${SUPPORT_STATUS_STYLES[t.status]}`}
              >
                {SUPPORT_STATUS_LABELS[t.status]}
              </span>
            </Td>
            <Td className="text-muted whitespace-nowrap">{formatDateTime(t.lastMessageAt)}</Td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
