import Link from "next/link";
import { getPlatformMetrics } from "@/lib/supabase/admin-data";
import { Card, StatTile } from "@/components/ui/Card";
import { AdminTable, Th, Td } from "@/components/admin/AdminTable";
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_STYLES } from "@/lib/utils/booking-status";
import { formatMoney, formatDate } from "@/lib/utils/format";
import type { BookingStatus } from "@/types/database";

export default async function AdminOverviewPage() {
  const m = await getPlatformMetrics();
  const statuses = Object.keys(BOOKING_STATUS_LABELS) as BookingStatus[];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Platform overview</h1>

      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total users" value={m.users} hint={`${m.newUsers7d} new this week`} />
        <StatTile
          label="Tutors"
          value={m.tutors}
          hint={`${m.tutorsApproved} approved · ${m.tutorsPending} pending`}
        />
        <StatTile label="Students" value={m.students} />
        <StatTile label="Active (24h)" value={m.activeUsers24h} hint="With booking activity" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Gross processed" value={formatMoney(m.grossProcessedCents, "usd")} />
        <StatTile
          label="Platform revenue"
          value={formatMoney(m.platformRevenueCents, "usd")}
          hint="Fees on completed lessons"
        />
        <StatTile label="Tutor earnings" value={formatMoney(m.tutorEarningsCents, "usd")} />
      </div>

      {m.tutorsPending > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-semibold">{m.tutorsPending}</span> tutor
              {m.tutorsPending === 1 ? "" : "s"} awaiting verification.
            </p>
            <Link
              href="/admin/tutors?status=pending"
              className="text-royal text-sm font-medium hover:underline"
            >
              Review now →
            </Link>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Recent bookings">
            <AdminTable
              isEmpty={m.recentBookings.length === 0}
              empty="No bookings yet."
              head={
                <>
                  <Th>Lesson</Th>
                  <Th>When</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Value</Th>
                </>
              }
            >
              {m.recentBookings.map((b) => (
                <tr key={b.id}>
                  <Td>
                    <span className="font-medium">{b.subject_name}</span>
                    <span className="text-muted block text-xs">
                      {b.student_name} · {b.tutor_name}
                    </span>
                  </Td>
                  <Td className="text-muted whitespace-nowrap">{formatDate(b.start_at)}</Td>
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
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Bookings by status">
            <ul className="flex flex-col gap-2 text-sm">
              {statuses.map((s) => (
                <li key={s} className="flex items-center justify-between">
                  <span className="text-muted">{BOOKING_STATUS_LABELS[s]}</span>
                  <span className="font-semibold">{m.bookingsByStatus[s] ?? 0}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Newest sign-ups">
            <ul className="flex flex-col gap-2 text-sm">
              {m.recentSignups.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{u.full_name}</span>
                  <span className="text-muted shrink-0 text-xs">{u.role}</span>
                </li>
              ))}
              {m.recentSignups.length === 0 && <li className="text-muted">No users yet.</li>}
            </ul>
          </Card>
        </div>
      </div>

      <p className="text-muted text-xs">
        Aggregate revenue is shown in USD. Multi-currency breakdowns, true DAU (event-based), fraud
        signals, and feature flags are planned — see the admin roadmap.
      </p>
    </div>
  );
}
