import { useCallback, useState } from "react";
import { View, Text } from "react-native";
import { useLocalSearchParams, router, Stack } from "expo-router";
import { api } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
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
import { SlotPicker } from "@/components/SlotPicker";
import { formatDateTimeIn, timeZoneLabel } from "@/lib/format";
import { spacing } from "@/lib/theme";
import type { AvailabilityDay, Booking } from "@/lib/api";

type BookingResponse = {
  booking: Booking & { tutor_id: string; lesson_duration_minutes: number };
  timezone: string;
  canReschedule: boolean;
};
type AvailabilityResponse = { timezone: string; days: AvailabilityDay[] };

export default function RescheduleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const [slot, setSlot] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const booking = useApi<BookingResponse>(id ? `/api/v1/bookings/${id}` : null, [id]);
  const tutorId = booking.data?.booking.tutor_id;
  const duration = booking.data?.booking.lesson_duration_minutes ?? 60;

  const slots = useApi<AvailabilityResponse>(
    tutorId ? `/api/v1/tutors/${tutorId}/availability?durationMinutes=${duration}` : null,
    [tutorId, duration],
  );

  const move = useMutation(
    useCallback(
      async (startAt: string) =>
        api.post<{ message?: string }>(`/api/v1/bookings/${id}/reschedule`, { startAt }),
      [id],
    ),
  );

  if (booking.loading) return <Loading />;
  if (booking.error || !booking.data) {
    return (
      <Screen>
        <ErrorState
          message={booking.error ?? "That lesson isn't available."}
          onRetry={booking.retryable ? booking.reload : undefined}
        />
      </Screen>
    );
  }

  const { timezone, canReschedule } = booking.data;
  const current = booking.data.booking;

  // The slot the lesson is already at is filtered out — the server refuses it
  // and an option that always errors is worse than no option.
  const days = (slots.data?.days ?? [])
    .map((day) => ({
      ...day,
      slots: day.slots.filter(
        (option) => new Date(option.startAt).getTime() !== new Date(current.start_at).getTime(),
      ),
    }))
    .filter((day) => day.slots.length > 0);

  if (done) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Lesson moved" }} />
        <Heading>Lesson moved</Heading>
        <Body muted>{done}</Body>
        <Button onPress={() => router.back()}>Done</Button>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Move lesson" }} />
      <View style={{ gap: spacing.xs }}>
        <Heading>Move this lesson</Heading>
        <Body muted>
          Currently {formatDateTimeIn(current.start_at, timezone)} (
          {timeZoneLabel(current.start_at, timezone)}). Moving a lesson doesn&apos;t change what was
          paid.
        </Body>
      </View>

      {!canReschedule ? (
        <EmptyState
          title="This lesson can't be moved"
          message="It's either no longer upcoming, or it starts too soon. Cancel it instead if you can't make it."
        />
      ) : slots.loading ? (
        <Loading label="Finding open times…" />
      ) : slots.error ? (
        <ErrorState message={slots.error} onRetry={slots.reload} />
      ) : days.length === 0 ? (
        <EmptyState
          title="No other open times"
          message="There are no other slots available right now. Try again later, or cancel and rebook."
        />
      ) : (
        <>
          <Card>
            <SlotPicker
              days={days}
              selected={slot}
              onSelect={setSlot}
              timezoneLabel={slots.data?.timezone ?? timezone}
            />
          </Card>

          {move.error ? (
            <Text accessibilityRole="alert" style={{ color: palette.danger }}>
              {move.error}
            </Text>
          ) : null}

          <Button
            onPress={async () => {
              if (!slot) return;
              const result = await move.run(slot);
              if (result) setDone(result.message ?? "We've let the other person know.");
            }}
            busy={move.busy}
            disabled={!slot}
          >
            {move.busy ? "Moving…" : "Move lesson"}
          </Button>
        </>
      )}
    </Screen>
  );
}
