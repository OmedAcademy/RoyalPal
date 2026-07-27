import Link from "next/link";
import { listTutors } from "@/lib/supabase/admin-data";
import { AdminTable, Th, Td } from "@/components/admin/AdminTable";
import { TutorVerifyActions } from "@/components/admin/TutorVerifyActions";
import { formatMoney, formatDate } from "@/lib/utils/format";
import type { TutorVerificationStatus } from "@/types/database";

const STATUS_BADGE: Record<TutorVerificationStatus, string> = {
  approved: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  rejected: "bg-red-100 text-red-700",
};

const FILTERS: { label: string; value?: TutorVerificationStatus }[] = [
  { label: "All" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

export default async function AdminTutorsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const validStatus = (["pending", "approved", "rejected"] as const).find((s) => s === status);
  const tutors = await listTutors({ status: validStatus, search: q });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Tutor management</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = f.value === validStatus;
            const href = f.value ? `/admin/tutors?status=${f.value}` : "/admin/tutors";
            return (
              <Link
                key={f.label}
                href={href}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-royal text-royal-contrast"
                    : "border-hairline text-muted hover:text-foreground border"
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </div>

        <form method="get" className="flex gap-2">
          {validStatus && <input type="hidden" name="status" value={validStatus} />}
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search name or headline"
            className="border-hairline-strong bg-surface focus:border-royal rounded-full border px-3.5 py-1.5 text-sm focus:outline-none"
          />
        </form>
      </div>

      <AdminTable
        isEmpty={tutors.length === 0}
        empty="No tutors match this view."
        head={
          <>
            <Th>Tutor</Th>
            <Th>Country</Th>
            <Th>Rate</Th>
            <Th>Rating</Th>
            <Th>Status</Th>
            <Th>Joined</Th>
            <Th>Actions</Th>
          </>
        }
      >
        {tutors.map((t) => (
          <tr key={t.id}>
            <Td>
              <Link href={`/student/tutors/${t.id}`} className="hover:text-royal font-medium">
                {t.full_name}
              </Link>
              <span className="text-muted block max-w-xs truncate text-xs">{t.headline}</span>
            </Td>
            <Td className="text-muted">{t.country ?? "—"}</Td>
            <Td className="whitespace-nowrap">{formatMoney(t.hourly_rate_cents, t.currency)}</Td>
            <Td className="text-muted whitespace-nowrap">
              {t.avg_rating != null ? `★ ${t.avg_rating.toFixed(1)} (${t.total_reviews})` : "—"}
            </Td>
            <Td>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[t.verification_status]}`}
              >
                {t.verification_status}
              </span>
            </Td>
            <Td className="text-muted whitespace-nowrap">{formatDate(t.created_at)}</Td>
            <Td>
              <TutorVerifyActions tutorId={t.id} status={t.verification_status} />
            </Td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
