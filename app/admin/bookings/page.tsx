import Link from "next/link";
import { listBookings } from "@/lib/supabase/admin-data";
import { AdminTable, Th, Td } from "@/components/admin/AdminTable";
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_STYLES } from "@/lib/utils/booking-status";
import { formatMoney, formatDateTime } from "@/lib/utils/format";
import type { BookingStatus } from "@/types/database";

const FILTERS: { label: string; value?: BookingStatus }[] = [
  { label: "All" },
  { label: "Pending", value: "pending_payment" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Refunded", value: "refunded" },
];

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const validStatus = (
    ["pending_payment", "confirmed", "completed", "cancelled", "refunded"] as const
  ).find((s) => s === status);
  const bookings = await listBookings(validStatus);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Booking management</h1>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = f.value === validStatus;
          const href = f.value ? `/admin/bookings?status=${f.value}` : "/admin/bookings";
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

      <AdminTable
        isEmpty={bookings.length === 0}
        empty="No bookings match this view."
        head={
          <>
            <Th>Lesson</Th>
            <Th>Student</Th>
            <Th>Tutor</Th>
            <Th>When</Th>
            <Th>Status</Th>
            <Th className="text-right">Value</Th>
          </>
        }
      >
        {bookings.map((b) => (
          <tr key={b.id}>
            <Td className="font-medium">{b.subject_name}</Td>
            <Td className="text-muted">{b.student_name}</Td>
            <Td className="text-muted">{b.tutor_name}</Td>
            <Td className="text-muted whitespace-nowrap">{formatDateTime(b.start_at)}</Td>
            <Td>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${BOOKING_STATUS_STYLES[b.status]}`}
              >
                {BOOKING_STATUS_LABELS[b.status]}
              </span>
            </Td>
            <Td className="text-right whitespace-nowrap">
              {formatMoney(b.price_cents, b.currency)}
            </Td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
