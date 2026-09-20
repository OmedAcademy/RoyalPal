import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getBookingsFor, type BookingWithParties } from "@/lib/supabase/bookings";
import { getTutorReviews, type ReviewWithAuthor } from "@/lib/supabase/reviews";
import { searchTutors, getTutorsByIds, type TutorSearchResult } from "@/lib/supabase/tutor-search";

const now = () => Date.now();
const isFuture = (b: BookingWithParties) => new Date(b.start_at).getTime() > now();

function zonedDayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// ---- Tutor dashboard ------------------------------------------------------

export type TutorDashboard = {
  today: BookingWithParties[];
  upcoming: BookingWithParties[];
  pending: BookingWithParties[];
  recentReviews: ReviewWithAuthor[];
  earnings: {
    earnedCents: number; // net of platform fee, completed lessons
    scheduledCents: number; // net, confirmed upcoming lessons
    lessonsCompleted: number;
    currency: string;
  };
};

export async function getTutorDashboard(
  userId: string,
  timezone: string,
  currency: string,
): Promise<TutorDashboard> {
  const [bookings, reviewPage] = await Promise.all([
    getBookingsFor(userId, "tutor"),
    getTutorReviews(userId),
  ]);
  const recentReviews = reviewPage.reviews;

  const todayKey = zonedDayKey(new Date(), timezone);
  const net = (b: BookingWithParties) => b.price_cents - b.platform_fee_cents;

  const today = bookings.filter(
    (b) =>
      (b.status === "confirmed" || b.status === "completed") &&
      zonedDayKey(new Date(b.start_at), timezone) === todayKey,
  );

  const upcoming = bookings.filter(
    (b) =>
      b.status === "confirmed" &&
      isFuture(b) &&
      zonedDayKey(new Date(b.start_at), timezone) !== todayKey,
  );

  const pending = bookings.filter((b) => b.status === "pending_payment");

  const completed = bookings.filter((b) => b.status === "completed");
  const scheduled = bookings.filter((b) => b.status === "confirmed" && isFuture(b));

  return {
    today,
    upcoming,
    pending,
    recentReviews: recentReviews.slice(0, 3),
    earnings: {
      earnedCents: completed.reduce((sum, b) => sum + net(b), 0),
      scheduledCents: scheduled.reduce((sum, b) => sum + net(b), 0),
      lessonsCompleted: completed.length,
      currency,
    },
  };
}

// ---- Student dashboard ----------------------------------------------------

export type StudentDashboard = {
  nextLesson: BookingWithParties | null;
  upcoming: BookingWithParties[];
  history: BookingWithParties[];
  toReview: BookingWithParties[];
  payments: BookingWithParties[];
  favorites: TutorSearchResult[];
  recommended: TutorSearchResult[];
};

export async function getStudentDashboard(userId: string): Promise<StudentDashboard> {
  const supabase = await createClient();

  const [bookings, favoriteRows, recommendedAll] = await Promise.all([
    getBookingsFor(userId, "student"),
    supabase.from("favorites").select("tutor_id").eq("student_id", userId),
    // Bounded: we render at most 6, and over-fetch slightly so filtering out
    // favourites can't empty the row.
    searchTutors({ pageSize: 12 }),
  ]);

  const favoriteIds = (favoriteRows.data ?? []).map((f) => f.tutor_id);
  const favorites = await getTutorsByIds(favoriteIds);
  const favoriteIdSet = new Set(favoriteIds);

  const upcoming = bookings
    .filter((b) => (b.status === "confirmed" || b.status === "pending_payment") && isFuture(b))
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

  const nextLesson = upcoming.find((b) => b.status === "confirmed") ?? null;

  // Most-recent first for the backward-looking lists.
  const byRecent = (a: BookingWithParties, b: BookingWithParties) =>
    new Date(b.start_at).getTime() - new Date(a.start_at).getTime();

  const history = bookings
    .filter((b) => ["completed", "cancelled", "refunded"].includes(b.status))
    .sort(byRecent);

  const toReview = bookings.filter((b) => b.status === "completed" && !b.reviewed).sort(byRecent);

  const payments = bookings
    .filter((b) => b.status === "confirmed" || b.status === "completed")
    .sort(byRecent);

  const recommended = recommendedAll.tutors.filter((t) => !favoriteIdSet.has(t.id)).slice(0, 6);

  return { nextLesson, upcoming, history, toReview, payments, favorites, recommended };
}
