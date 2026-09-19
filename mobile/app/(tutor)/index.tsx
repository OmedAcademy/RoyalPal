import { View, Text, Linking } from "react-native";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import {
  Screen,
  Heading,
  Body,
  Card,
  Badge,
  Button,
  Loading,
  ErrorState,
  EmptyState,
} from "@/components/ui";
import { BookingCard } from "@/components/BookingCard";
import { spacing } from "@/lib/theme";
import type { Booking } from "@/lib/api";

const WEB = process.env.EXPO_PUBLIC_API_URL ?? "";

type BookingsResponse = { bookings: Booking[]; timezone: string };

const VERIFICATION_TONE = {
  approved: "success",
  pending: "warning",
  rejected: "danger",
} as const;

export default function TutorHomeScreen() {
  const { me } = useAuth();
  const state = useApi<BookingsResponse>("/api/v1/bookings");

  const verification = (me?.roleProfile?.verification_status as string | undefined) ?? "pending";
  const rejectionReason = me?.roleProfile?.rejection_reason as string | undefined;

  const timezone = state.data?.timezone ?? me?.profile.timezone ?? "UTC";
  const upcoming = (state.data?.bookings ?? [])
    .filter((b) => ["pending_payment", "confirmed"].includes(b.status))
    .filter((b) => new Date(b.end_at).getTime() > Date.now())
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

  return (
    <Screen refreshing={state.refreshing} onRefresh={state.refresh}>
      <View style={{ gap: spacing.xs }}>
        <Body muted>Hello, {me?.profile.fullName.split(" ")[0] ?? "there"}</Body>
        <Heading>Your teaching</Heading>
      </View>

      <Card>
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <Text style={{ fontWeight: "600" }}>Verification</Text>
          <Badge
            label={
              verification === "approved"
                ? "Approved"
                : verification === "pending"
                  ? "Pending review"
                  : "Needs changes"
            }
            tone={VERIFICATION_TONE[verification as keyof typeof VERIFICATION_TONE] ?? "neutral"}
          />
        </View>
        <Body muted>
          {verification === "approved"
            ? "Students can find and book you."
            : verification === "pending"
              ? "We're reviewing your profile. You'll get a notification when it's decided."
              : (rejectionReason ??
                "Your profile needs changes before it can go live. Update it and we'll review it again.")}
        </Body>
        {verification !== "approved" ? (
          <Button variant="secondary" onPress={() => Linking.openURL(`${WEB}/tutor/profile`)}>
            Update profile
          </Button>
        ) : null}
      </Card>

      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.retryable ? state.reload : undefined} />
      ) : upcoming.length === 0 ? (
        <EmptyState
          title="No lessons scheduled"
          message={
            verification === "approved"
              ? "Add availability so students can book you."
              : "Once your profile is approved, bookings will appear here."
          }
        />
      ) : (
        upcoming.map((booking) => (
          <BookingCard key={booking.id} booking={booking} timezone={timezone} viewerRole="tutor" />
        ))
      )}
    </Screen>
  );
}
