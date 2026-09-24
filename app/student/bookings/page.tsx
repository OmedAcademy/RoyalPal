import { requireProfile } from "@/lib/supabase/queries";
import { getBookingsFor } from "@/lib/supabase/bookings";
import { BookingCard } from "@/components/booking/BookingCard";

export default async function StudentBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const profile = await requireProfile(["student"]);
  const { payment } = await searchParams;
  const bookings = await getBookingsFor(profile.id, "student");

  const upcoming = bookings.filter(
    (b) => b.status === "pending_payment" || b.status === "confirmed",
  );
  const history = bookings.filter((b) => !["pending_payment", "confirmed"].includes(b.status));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Your bookings</h1>
        {payment === "success" && (
          <p role="status" className="mt-1 text-sm text-green-700 dark:text-green-400">
            Payment received — your lesson is confirmed below. (It may show as pending for a few
            seconds while the payment finishes processing.)
          </p>
        )}
        {payment === "cancelled" && (
          <p role="status" className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            Checkout was cancelled. Pick a booking below to complete payment, or book a new time.
          </p>
        )}
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Upcoming</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">No upcoming lessons yet.</p>
          ) : (
            upcoming.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                viewerRole="student"
                viewerTimezone={profile.timezone}
              />
            ))
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">History</h2>
          {history.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">No past lessons yet.</p>
          ) : (
            history.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                viewerRole="student"
                viewerTimezone={profile.timezone}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}
