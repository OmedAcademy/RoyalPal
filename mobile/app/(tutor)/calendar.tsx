import { View, Text, Linking } from "react-native";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
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

const WEB = process.env.EXPO_PUBLIC_API_URL ?? "";

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
    <Screen refreshing={bookings.refreshing} onRefresh={bookings.refresh}>
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
        {availability.loading ? (
          <Body muted>Loading…</Body>
        ) : availability.data && availability.data.rules.length > 0 ? (
          <View style={{ gap: spacing.xs }}>
            {availability.data.rules
              .slice()
              .sort((a, b) => a.day_of_week - b.day_of_week)
              .map((rule, index) => (
                <Text key={`${rule.day_of_week}-${index}`} style={{ color: palette.muted }}>
                  {DAY_NAMES[rule.day_of_week]} · {rule.start_time.slice(0, 5)}–
                  {rule.end_time.slice(0, 5)}
                </Text>
              ))}
            {availability.data.exceptions.length > 0 ? (
              <Text style={{ color: palette.muted, marginTop: spacing.xs }}>
                {availability.data.exceptions.length} date exception
                {availability.data.exceptions.length === 1 ? "" : "s"} set.
              </Text>
            ) : null}
          </View>
        ) : (
          <Body muted>You haven&apos;t set any availability yet, so nobody can book you.</Body>
        )}
        {/* Editing the weekly grid is a web-only surface for now, and saying so
            is better than a native-looking button that opens a browser without
            warning. Tracked as a known gap in docs/MOBILE.md. */}
        <Button variant="secondary" onPress={() => Linking.openURL(`${WEB}/tutor/availability`)}>
          Edit availability on the web
        </Button>
      </Card>
    </Screen>
  );
}
