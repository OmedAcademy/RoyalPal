import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { Screen, Heading, Loading, ErrorState, EmptyState, usePalette } from "@/components/ui";
import { BookingCard } from "@/components/BookingCard";
import { spacing, radius, MIN_TOUCH_TARGET } from "@/lib/theme";
import type { Booking } from "@/lib/api";

type BookingsResponse = { bookings: Booking[]; timezone: string };

export default function TutorLessonsScreen() {
  const { me } = useAuth();
  const palette = usePalette();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const state = useApi<BookingsResponse>("/api/v1/bookings");

  const timezone = state.data?.timezone ?? me?.profile.timezone ?? "UTC";
  const all = state.data?.bookings ?? [];
  const shown =
    tab === "upcoming"
      ? all
          .filter((b) => ["pending_payment", "confirmed"].includes(b.status))
          .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      : all
          .filter((b) => ["completed", "cancelled", "refunded"].includes(b.status))
          .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());

  return (
    <Screen refreshing={state.refreshing} onRefresh={state.refresh}>
      <Heading>Lessons</Heading>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {(["upcoming", "past"] as const).map((option) => {
          const active = tab === option;
          return (
            <Pressable
              key={option}
              onPress={() => setTab(option)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                paddingHorizontal: spacing.lg,
                justifyContent: "center",
                borderRadius: radius.pill,
                backgroundColor: active ? palette.royal : "transparent",
                borderWidth: active ? 0 : 1,
                borderColor: palette.hairlineStrong,
              }}
            >
              <Text
                style={{
                  fontWeight: "600",
                  color: active ? palette.royalContrast : palette.foreground,
                }}
              >
                {option === "upcoming" ? "Upcoming" : "Past"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.retryable ? state.reload : undefined} />
      ) : shown.length === 0 ? (
        <EmptyState
          title={tab === "upcoming" ? "Nothing booked" : "No past lessons"}
          message={
            tab === "upcoming"
              ? "Students who book you will appear here."
              : "Lessons you've taught will appear here."
          }
        />
      ) : (
        shown.map((booking) => (
          <BookingCard key={booking.id} booking={booking} timezone={timezone} viewerRole="tutor" />
        ))
      )}
    </Screen>
  );
}
