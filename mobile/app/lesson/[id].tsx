import { useCallback, useState } from "react";
import { View, Text, Linking, Alert } from "react-native";
import { useLocalSearchParams, router, Stack } from "expo-router";
import { api } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { Screen, Heading, Body, Card, Button, Badge, Loading, ErrorState, usePalette } from "@/components/ui";
import { formatDateTimeIn, formatMoney, timeZoneLabel, BOOKING_STATUS_LABELS } from "@/lib/format";
import { spacing } from "@/lib/theme";
import type { Booking } from "@/lib/api";

type Response = {
  booking: Booking & { conversation_id: string | null; cancellation_reason: string | null };
  timezone: string;
  viewerRole: "student" | "tutor";
  canCancel: boolean;
  canReschedule: boolean;
  /** What the policy WOULD do if cancelled right now — shown before the tap. */
  cancellationPreview: { refundOwedCents: number; explanation: string } | null;
};

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const [done, setDone] = useState<string | null>(null);
  const state = useApi<Response>(id ? `/api/v1/bookings/${id}` : null, [id]);

  const cancel = useMutation(
    useCallback(async () => api.post<{ message?: string }>(`/api/v1/bookings/${id}/cancel`), [id]),
  );

  if (state.loading) return <Loading />;
  if (state.error || !state.data) {
    return (
      <Screen>
        <ErrorState
          message={state.error ?? "That lesson isn't available."}
          onRetry={state.retryable ? state.reload : undefined}
        />
      </Screen>
    );
  }

  const { booking, timezone, viewerRole, canCancel, cancellationPreview } = state.data;
  const other = viewerRole === "student" ? booking.tutor_name : booking.student_name;

  function confirmCancel() {
    Alert.alert(
      "Cancel this lesson?",
      // The refund consequence is stated BEFORE the irreversible tap, not
      // discovered afterwards.
      cancellationPreview?.explanation ?? "This can't be undone.",
      [
        { text: "Keep lesson", style: "cancel" },
        {
          text: "Cancel lesson",
          style: "destructive",
          onPress: async () => {
            const result = await cancel.run(undefined);
            if (result) {
              setDone(result.message ?? "Lesson cancelled.");
              state.refresh();
            }
          },
        },
      ],
    );
  }

  return (
    <Screen refreshing={state.refreshing} onRefresh={state.refresh}>
      <Stack.Screen options={{ title: "Lesson" }} />

      <View style={{ gap: spacing.xs }}>
        <Heading>
          {booking.subject_name ?? "Lesson"} with {other}
        </Heading>
        <Body muted>
          {formatDateTimeIn(booking.start_at, timezone)} (
          {timeZoneLabel(booking.start_at, timezone)})
        </Body>
        <Badge label={BOOKING_STATUS_LABELS[booking.status] ?? booking.status} />
      </View>

      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Body muted>Price</Body>
          <Text style={{ fontWeight: "600", color: palette.foreground }}>
            {formatMoney(booking.price_cents, booking.currency)}
          </Text>
        </View>
        {booking.cancellation_reason ? (
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}>
            <Body muted>Reason</Body>
            <Text style={{ flex: 1, textAlign: "right", color: palette.foreground }}>
              {booking.cancellation_reason}
            </Text>
          </View>
        ) : null}
      </Card>

      {booking.meeting_url && booking.status === "confirmed" ? (
        <Button onPress={() => Linking.openURL(booking.meeting_url!)}>Join lesson</Button>
      ) : null}

      {booking.conversation_id ? (
        <Button
          variant="secondary"
          onPress={() => router.push(`/messages/${booking.conversation_id}`)}
        >
          Message {other}
        </Button>
      ) : null}

      {done ? (
        <Text accessibilityRole="alert" style={{ color: palette.success }}>
          {done}
        </Text>
      ) : canCancel ? (
        <>
          {cancellationPreview ? <Body muted>{cancellationPreview.explanation}</Body> : null}
          <Button variant="danger" onPress={confirmCancel} busy={cancel.busy}>
            Cancel lesson
          </Button>
        </>
      ) : null}

      {cancel.error ? (
        <Text accessibilityRole="alert" style={{ color: palette.danger }}>
          {cancel.error}
        </Text>
      ) : null}
    </Screen>
  );
}
