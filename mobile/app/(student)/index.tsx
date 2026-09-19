import { View, Text } from "react-native";
import { router } from "expo-router";
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
} from "@/components/ui";
import { BookingCard } from "@/components/BookingCard";
import { spacing } from "@/lib/theme";
import type { Booking } from "@/lib/api";

type BookingsResponse = { bookings: Booking[]; timezone: string };

export default function StudentHomeScreen() {
  const { me } = useAuth();
  const state = useApi<BookingsResponse>("/api/v1/bookings");

  if (state.loading) return <Loading />;

  const timezone = state.data?.timezone ?? me?.profile.timezone ?? "UTC";
  const upcoming = (state.data?.bookings ?? [])
    .filter((b) => ["pending_payment", "confirmed"].includes(b.status))
    .filter((b) => new Date(b.end_at).getTime() > Date.now())
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

  const firstName = me?.profile.fullName.split(" ")[0] ?? "there";

  return (
    <Screen refreshing={state.refreshing} onRefresh={state.refresh}>
      <View style={{ gap: spacing.xs }}>
        <Body muted>Hello, {firstName}</Body>
        <Heading>Your lessons</Heading>
      </View>

      {state.error ? (
        <ErrorState message={state.error} onRetry={state.retryable ? state.reload : undefined} />
      ) : upcoming.length === 0 ? (
        <EmptyState
          title="No lessons booked"
          message="Find a tutor and book your first lesson — it takes a couple of minutes."
          action={<Button onPress={() => router.push("/(student)/search")}>Find a tutor</Button>}
        />
      ) : (
        upcoming.map((booking) => (
          <BookingCard
            key={booking.id}
            booking={booking}
            timezone={timezone}
            viewerRole="student"
          />
        ))
      )}

      <Card>
        <Text style={{ fontWeight: "600" }}>Saved tutors</Text>
        <Body muted>Tutors you&apos;ve saved while browsing.</Body>
        <Button variant="secondary" onPress={() => router.push("/saved")}>
          View saved tutors
        </Button>
      </Card>
    </Screen>
  );
}
