import { listPayments } from "@/lib/supabase/admin-data";
import { AdminTable, Th, Td } from "@/components/admin/AdminTable";
import { formatMoney, formatDateTime } from "@/lib/utils/format";
import type { PaymentStatus } from "@/types/database";

const PAYMENT_BADGE: Record<PaymentStatus, string> = {
  succeeded: "bg-emerald-100 text-emerald-800",
  requires_payment: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-700",
  refunded: "bg-slate-100 text-slate-700",
  expired: "bg-slate-100 text-slate-700",
};

export default async function AdminPaymentsPage() {
  const payments = await listPayments();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Payment management</h1>
      <p className="text-muted -mt-2 text-sm">
        Read-only ledger. Refunds move real money and are intentionally not executed from this
        console — they belong to a separate, audited Stripe refund flow (planned).
      </p>

      <AdminTable
        isEmpty={payments.length === 0}
        empty="No payments recorded yet."
        head={
          <>
            <Th>Lesson</Th>
            <Th>Student</Th>
            <Th>Tutor</Th>
            <Th>Status</Th>
            <Th>Paid</Th>
            <Th className="text-right">Amount</Th>
          </>
        }
      >
        {payments.map((p) => (
          <tr key={p.id}>
            <Td className="font-medium">{p.booking?.subject_name ?? "—"}</Td>
            <Td className="text-muted">{p.booking?.student_name ?? "—"}</Td>
            <Td className="text-muted">{p.booking?.tutor_name ?? "—"}</Td>
            <Td>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_BADGE[p.status]}`}
              >
                {p.status}
              </span>
            </Td>
            <Td className="text-muted whitespace-nowrap">
              {p.paid_at ? formatDateTime(p.paid_at) : "—"}
            </Td>
            <Td className="text-right whitespace-nowrap">
              {formatMoney(p.amount_cents, p.currency)}
            </Td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
