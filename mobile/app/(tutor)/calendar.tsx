import { View, Text } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { viewState } from "@/lib/view-state";
import {
  Screen,
  Heading,
  Body,
  Card,
  Button,
  Loading,
  ErrorState,
  EmptyState,
  usePalette,
} from "@/components/ui";
import { formatDateIn, formatTimeIn, timeZoneLabel } from "@/lib/format";
import { spacing } from "@/lib/theme";
import type { Booking } from "@/lib/api";

type BookingsResponse = { bookings: Booking[]; timezone: string };
type AvailabilityResponse = {
  timezone: string;
  rules: { day_of_week: number; start_time: string; end_time: string }[];
  exceptions: {
    date: string;
    start_time: string | null;
    end_time: string | null;
    is_available: boolean;
  }[];
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function TutorCalendarScreen() {
  const palette = usePalette();
  const { me } = useAuth();
  const bookings = useApi<BookingsResponse>("/api/v1/bookings");
  const availability = useApi<AvailabilityResponse>("/api/v1/availability");
  // Four states, decided from the data rather than from whichever branch a
  // ternary fell into. The else branch used to absorb a failed request and
  // tell a tutor nobody could book them.
  const availabilityView = viewState(availability, (a) => a.rules.length === 0);

  const timezone = bookings.data?.timezone ?? me?.profile.timezone ?? "UTC";
  const upcoming = (bookings.data?.bookings ?? [])
    .filter((b) => b.status === "confirmed" || b.status === "pending_payment")
    .filter((b) => new Date(b.end_at).getTime() > Date.now())
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

  // Grouped by the tutor's OWN day boundaries, from the server's zone rather
  // than the device's — the same reason the availability endpoint groups
  // server-side.
  const byDay = new Map<string, Booking[]>();
  for (const booking of upcoming) {
    const key = formatDateIn(booking.start_at, timezone);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(booking);
  }

  return (
    <Screen
      refreshing={bookings.refreshing || availability.refreshing}
      onRefresh={() => {
        // Both, because the error state below tells people to pull down to
        // retry the availability request — and it only refreshed the bookings.
        bookings.refresh();
        availability.refresh();
      }}
    >
      <Heading>Calendar</Heading>
      <Body muted>
        Times shown in your own time zone
        {upcoming[0] ? ` (${timeZoneLabel(upcoming[0].start_at, timezone)})` : ""}.
      </Body>

      {bookings.loading ? (
        <Loading />
      ) : bookings.error ? (
        <ErrorState
          message={bookings.error}
          onRetry={bookings.retryable ? bookings.reload : undefined}
        />
      ) : byDay.size === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          message="Confirmed lessons will appear here by day."
        />
      ) : (
        [...byDay.entries()].map(([day, dayBookings]) => (
          <Card key={day}>
            <Text style={{ fontWeight: "700", color: palette.foreground }}>{day}</Text>
            {dayBookings.map((booking) => (
              <View
                key={booking.id}
                style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}
              >
                <Text style={{ color: palette.foreground }}>
                  {formatTimeIn(booking.start_at, timezone)}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: palette.muted, flex: 1, textAlign: "right" }}
                >
                  {booking.student_name}
                </Text>
              </View>
            ))}
          </Card>
        ))
      )}

      <Card>
        <Text style={{ fontWeight: "600" }}>Your weekly availability</Text>
        {availabilityView.kind === "loading" ? (
          <Body muted>Loading…</Body>
        ) : availabilityView.kind === "error" ? (
          <Body muted>
            We couldn&apos;t load your availability just now, so this may be out of date. Pull down
            to try again.
          </Body>
        ) : availabilityView.kind === "ready" ? (
          <View style={{ gap: spacing.xs }}>
            {availabilityView.data.rules
              .slice()
              .sort((a, b) => a.day_of_week - b.day_of_week)
              .map((rule, index) => (
                <Text key={`${rule.day_of_week}-${index}`} style={{ color: palette.muted }}>
                  {DAY_NAMES[rule.day_of_week]} · {rule.start_time.slice(0, 5)}–
                  {rule.end_time.slice(0, 5)}
                </Text>
              ))}
            {availabilityView.data.exceptions.length > 0 ? (
              <Text style={{ color: palette.muted, marginTop: spacing.xs }}>
                {availabilityView.data.exceptions.length} date exception
                {availabilityView.data.exceptions.length === 1 ? "" : "s"} set.
              </Text>
            ) : null}
          </View>
        ) : (
          <Body muted>You haven&apos;t set any availability yet, so nobody can book you.</Body>
        )}
        <Button variant="secondary" onPress={() => router.push("/availability/edit")}>
          Edit availability
        </Button>
      </Card>
    </Screen>
  );
}
