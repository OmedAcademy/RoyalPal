import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  BookingStatus,
  PaymentStatus,
  TransferStatus,
  TutorVerificationStatus,
  UserRole,
} from "@/types/database";

/**
 * Read layer for the admin console. Uses the service-role client because an
 * administrator legitimately needs cross-tenant visibility that RLS
 * deliberately denies to normal users. Every caller is an admin-gated
 * Server Component (see app/admin/* — requireProfile(["admin"])), so this
 * bypass is always behind that gate.
 *
 * Aggregates here sum in application code over bounded result sets, which is
 * correct and fast at beta volume. The scale-up path is a set of SQL
 * aggregate RPCs / a materialized `admin_metrics` view — noted for later so
 * these never fan out to unbounded row fetches in production.
 */

const BOOKING_STATUSES: BookingStatus[] = [
  "pending_payment",
  "confirmed",
  "completed",
  "cancelled",
  "refunded",
];

export type AdminBookingRow = {
  id: string;
  status: BookingStatus;
  start_at: string;
  price_cents: number;
  platform_fee_cents: number;
  currency: string;
  student_name: string;
  tutor_name: string;
  subject_name: string;
};

type RawAdminBooking = {
  id: string;
  status: BookingStatus;
  start_at: string;
  price_cents: number;
  platform_fee_cents: number;
  currency: string;
  student: { full_name: string } | null;
  tutor_profiles: { profiles: { full_name: string } | null } | null;
  subjects: { name: string } | null;
};

const ADMIN_BOOKING_SELECT =
  "id, status, start_at, price_cents, platform_fee_cents, currency, student:profiles!bookings_student_id_fkey(full_name), tutor_profiles!bookings_tutor_id_fkey(profiles!tutor_profiles_id_fkey(full_name)), subjects(name)";

function shapeBooking(row: RawAdminBooking): AdminBookingRow {
  return {
    id: row.id,
    status: row.status,
    start_at: row.start_at,
    price_cents: row.price_cents,
    platform_fee_cents: row.platform_fee_cents,
    currency: row.currency,
    student_name: row.student?.full_name ?? "Student",
    tutor_name: row.tutor_profiles?.profiles?.full_name ?? "Tutor",
    subject_name: row.subjects?.name ?? "Lesson",
  };
}

export type PlatformMetrics = {
  users: number;
  students: number;
  tutors: number;
  tutorsPending: number;
  tutorsApproved: number;
  bookingsTotal: number;
  bookingsByStatus: Record<BookingStatus, number>;
  grossProcessedCents: number;
  platformRevenueCents: number;
  tutorEarningsCents: number;
  newUsers7d: number;
  activeUsers24h: number;
  recentBookings: AdminBookingRow[];
  recentSignups: { id: string; full_name: string; role: UserRole; created_at: string }[];
};

export async function getPlatformMetrics(): Promise<PlatformMetrics> {
  const admin = createAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

  const [
    users,
    students,
    tutors,
    tutorsPending,
    tutorsApproved,
    bookingsTotal,
    newUsers7d,
    statusCounts,
    succeededPayments,
    completedBookings,
    recentBookingsRes,
    recentSignupsRes,
    activeRes,
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .then((r) => r.count ?? 0),
    admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "student")
      .then((r) => r.count ?? 0),
    admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "tutor")
      .then((r) => r.count ?? 0),
    admin
      .from("tutor_profiles")
      .select("*", { count: "exact", head: true })
      .eq("verification_status", "pending")
      .then((r) => r.count ?? 0),
    admin
      .from("tutor_profiles")
      .select("*", { count: "exact", head: true })
      .eq("verification_status", "approved")
      .then((r) => r.count ?? 0),
    admin
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .then((r) => r.count ?? 0),
    admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo)
      .then((r) => r.count ?? 0),
    Promise.all(
      BOOKING_STATUSES.map((s) =>
        admin
          .from("bookings")
          .select("*", { count: "exact", head: true })
          .eq("status", s)
          .then((r) => [s, r.count ?? 0] as const),
      ),
    ),
    admin.from("payments").select("amount_cents").eq("status", "succeeded"),
    admin.from("bookings").select("price_cents, platform_fee_cents").eq("status", "completed"),
    admin
      .from("bookings")
      .select(ADMIN_BOOKING_SELECT)
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("profiles")
      .select("id, full_name, role, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
    admin.from("bookings").select("student_id").gte("created_at", dayAgo),
  ]);

  const grossProcessedCents = (succeededPayments.data ?? []).reduce(
    (s, p) => s + (p.amount_cents ?? 0),
    0,
  );
  const platformRevenueCents = (completedBookings.data ?? []).reduce(
    (s, b) => s + (b.platform_fee_cents ?? 0),
    0,
  );
  const tutorEarningsCents = (completedBookings.data ?? []).reduce(
    (s, b) => s + ((b.price_cents ?? 0) - (b.platform_fee_cents ?? 0)),
    0,
  );
  const activeUsers24h = new Set((activeRes.data ?? []).map((r) => r.student_id)).size;

  const bookingsByStatus = Object.fromEntries(statusCounts) as Record<BookingStatus, number>;

  return {
    users,
    students,
    tutors,
    tutorsPending,
    tutorsApproved,
    bookingsTotal,
    bookingsByStatus,
    grossProcessedCents,
    platformRevenueCents,
    tutorEarningsCents,
    newUsers7d,
    activeUsers24h,
    recentBookings: ((recentBookingsRes.data as RawAdminBooking[] | null) ?? []).map(shapeBooking),
    recentSignups: recentSignupsRes.data ?? [],
  };
}

// ---- Lists ----------------------------------------------------------------

export type AdminTutorRow = {
  id: string;
  full_name: string;
  country: string | null;
  headline: string;
  verification_status: TutorVerificationStatus;
  hourly_rate_cents: number;
  currency: string;
  avg_rating: number | null;
  total_reviews: number;
  created_at: string;
};

export async function listTutors(opts: {
  status?: TutorVerificationStatus;
  search?: string;
}): Promise<AdminTutorRow[]> {
  const admin = createAdminClient();
  let q = admin
    .from("tutor_profiles")
    .select(
      "id, headline, verification_status, hourly_rate_cents, currency, avg_rating, total_reviews, created_at, profiles!tutor_profiles_id_fkey(full_name, country)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (opts.status) q = q.eq("verification_status", opts.status);

  type Row = {
    id: string;
    headline: string;
    verification_status: TutorVerificationStatus;
    hourly_rate_cents: number;
    currency: string;
    avg_rating: number | null;
    total_reviews: number;
    created_at: string;
    profiles: { full_name: string; country: string | null } | null;
  };

  const { data } = await q.returns<Row[]>();
  let rows = (data ?? []).map((r) => ({
    id: r.id,
    full_name: r.profiles?.full_name ?? "Tutor",
    country: r.profiles?.country ?? null,
    headline: r.headline,
    verification_status: r.verification_status,
    hourly_rate_cents: r.hourly_rate_cents,
    currency: r.currency,
    avg_rating: r.avg_rating,
    total_reviews: r.total_reviews,
    created_at: r.created_at,
  }));

  if (opts.search) {
    const needle = opts.search.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.full_name.toLowerCase().includes(needle) || r.headline.toLowerCase().includes(needle),
    );
  }
  return rows;
}

export type AdminUserRow = {
  id: string;
  full_name: string;
  role: UserRole;
  status: string;
  country: string | null;
  created_at: string;
};

export async function listUsers(opts: {
  role?: UserRole;
  search?: string;
}): Promise<AdminUserRow[]> {
  const admin = createAdminClient();
  let q = admin
    .from("profiles")
    .select("id, full_name, role, status, country, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (opts.role) q = q.eq("role", opts.role);

  const { data } = await q;
  let rows = (data ?? []) as AdminUserRow[];
  if (opts.search) {
    const needle = opts.search.toLowerCase();
    rows = rows.filter((r) => r.full_name.toLowerCase().includes(needle));
  }
  return rows;
}

export async function listBookings(status?: BookingStatus): Promise<AdminBookingRow[]> {
  const admin = createAdminClient();
  let q = admin
    .from("bookings")
    .select(ADMIN_BOOKING_SELECT)
    .order("start_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);
  const { data } = await q.returns<RawAdminBooking[]>();
  return (data ?? []).map(shapeBooking);
}

export type AdminPaymentRow = {
  id: string;
  booking_id: string;
  amount_cents: number;
  currency: string;
  status: PaymentStatus;
  created_at: string;
  paid_at: string | null;
  // Payout and dispute state (migration 0024, written by the Stripe webhook
  // handlers). Surfaced here so the data isn't write-only.
  transfer_status: TransferStatus | null;
  dispute_status: string | null;
  booking: { subject_name: string; student_name: string; tutor_name: string } | null;
};

export async function listPayments(): Promise<AdminPaymentRow[]> {
  const admin = createAdminClient();
  type Row = {
    id: string;
    booking_id: string;
    amount_cents: number;
    currency: string;
    status: PaymentStatus;
    created_at: string;
    paid_at: string | null;
    transfer_status: TransferStatus | null;
    dispute_status: string | null;
    bookings: {
      student: { full_name: string } | null;
      tutor_profiles: { profiles: { full_name: string } | null } | null;
      subjects: { name: string } | null;
    } | null;
  };
  const { data } = await admin
    .from("payments")
    .select(
      "id, booking_id, amount_cents, currency, status, created_at, paid_at, transfer_status, dispute_status, bookings(student:profiles!bookings_student_id_fkey(full_name), tutor_profiles!bookings_tutor_id_fkey(profiles!tutor_profiles_id_fkey(full_name)), subjects(name))",
    )
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<Row[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    booking_id: r.booking_id,
    amount_cents: r.amount_cents,
    currency: r.currency,
    status: r.status,
    created_at: r.created_at,
    paid_at: r.paid_at,
    transfer_status: r.transfer_status,
    dispute_status: r.dispute_status,
    booking: r.bookings
      ? {
          subject_name: r.bookings.subjects?.name ?? "Lesson",
          student_name: r.bookings.student?.full_name ?? "Student",
          tutor_name: r.bookings.tutor_profiles?.profiles?.full_name ?? "Tutor",
        }
      : null,
  }));
}

export type AdminReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  hidden_at: string | null;
  hidden_reason: string | null;
  tutor_reply: string | null;
  student_name: string;
  tutor_name: string;
};

export async function listReviews(): Promise<AdminReviewRow[]> {
  const admin = createAdminClient();
  type Row = {
    id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    hidden_at: string | null;
    hidden_reason: string | null;
    tutor_reply: string | null;
    student: { full_name: string } | null;
    tutor_profiles: { profiles: { full_name: string } | null } | null;
  };
  // The service role sees hidden reviews too — that is the point of a
  // moderation queue, and the only place they remain visible besides their
  // own author.
  const { data } = await admin
    .from("reviews")
    .select(
      "id, rating, comment, created_at, hidden_at, hidden_reason, tutor_reply, student:profiles!reviews_student_id_fkey(full_name), tutor_profiles!reviews_tutor_id_fkey(profiles!tutor_profiles_id_fkey(full_name))",
    )
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<Row[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    created_at: r.created_at,
    hidden_at: r.hidden_at,
    hidden_reason: r.hidden_reason,
    tutor_reply: r.tutor_reply,
    student_name: r.student?.full_name ?? "Student",
    tutor_name: r.tutor_profiles?.profiles?.full_name ?? "Tutor",
  }));
}

export type AdminAuditRow = {
  id: string;
  action: string;
  target_id: string | null;
  notes: string | null;
  created_at: string;
  admin_name: string;
};

export async function listAuditLog(): Promise<AdminAuditRow[]> {
  const admin = createAdminClient();
  type Row = {
    id: string;
    action: string;
    target_id: string | null;
    notes: string | null;
    created_at: string;
    profiles: { full_name: string } | null;
  };
  const { data } = await admin
    .from("admin_actions")
    .select(
      "id, action, target_id, notes, created_at, profiles!admin_actions_admin_id_fkey(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<Row[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    action: r.action,
    target_id: r.target_id,
    notes: r.notes,
    created_at: r.created_at,
    admin_name: r.profiles?.full_name ?? "Admin",
  }));
}
