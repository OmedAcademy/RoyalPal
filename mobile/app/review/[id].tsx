import { useCallback, useState } from "react";
import { View, Text, Pressable, TextInput } from "react-native";
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
  STACK_EDGES,
} from "@/components/ui";
import { formatDateTimeIn } from "@/lib/format";
import { spacing, radius, MIN_TOUCH_TARGET } from "@/lib/theme";
import type { Booking } from "@/lib/api";

type BookingResponse = {
  booking: Booking & { reviewed: boolean };
  timezone: string;
  viewerRole: "student" | "tutor";
};

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const state = useApi<BookingResponse>(id ? `/api/v1/bookings/${id}` : null, [id]);

  const submit = useMutation(
    useCallback(
      async (payload: { rating: number; comment: string }) =>
        api.post<{ message?: string }>("/api/v1/reviews", {
          bookingId: id,
          rating: payload.rating,
          comment: payload.comment || undefined,
        }),
      [id],
    ),
  );

  if (state.loading) return <Loading />;
  if (state.error || !state.data) {
    return (
      <Screen edges={STACK_EDGES}>
        <ErrorState
          message={state.error ?? "That lesson isn't available."}
          onRetry={state.retryable ? state.reload : undefined}
        />
      </Screen>
    );
  }

  const { booking, timezone, viewerRole } = state.data;

  if (done) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Thanks" }} />
        <Heading>Thanks for the review</Heading>
        <Body muted>{done}</Body>
        <Button onPress={() => router.back()}>Done</Button>
      </Screen>
    );
  }

  // Eligibility is the database's call (a completed, paid lesson, reviewed
  // once, by the student). This only avoids showing a form that would be
  // refused — it is not the check.
  if (viewerRole !== "student") {
    return (
      <Screen>
        <EmptyState title="Not available" message="Only the student on a lesson can review it." />
      </Screen>
    );
  }
  if (booking.status !== "completed") {
    return (
      <Screen>
        <EmptyState
          title="Not yet"
          message="You can review a lesson once it's finished. We'll let you know when it is."
        />
      </Screen>
    );
  }
  if (booking.reviewed) {
    return (
      <Screen>
        <EmptyState
          title="Already reviewed"
          message="You've reviewed this lesson. Reviews can't be edited once they're submitted."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Leave a review" }} />
      <View style={{ gap: spacing.xs }}>
        <Heading>How was your lesson?</Heading>
        <Body muted>
          {booking.subject_name ?? "Lesson"} with {booking.tutor_name} ·{" "}
          {formatDateTimeIn(booking.start_at, timezone)}
        </Body>
      </View>

      <Card>
        <Text style={{ fontWeight: "600" }}>Your rating</Text>
        <View style={{ flexDirection: "row", gap: spacing.xs }} accessibilityRole="radiogroup">
          {[1, 2, 3, 4, 5].map((value) => {
            const active = value <= rating;
            return (
              <Pressable
                key={value}
                onPress={() => setRating(value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: rating === value }}
                accessibilityLabel={`${value} star${value === 1 ? "" : "s"}`}
                hitSlop={6}
                style={{
                  width: MIN_TOUCH_TARGET,
                  height: MIN_TOUCH_TARGET,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 30, color: active ? "#D4AF37" : palette.hairlineStrong }}>
                  ★
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={{ fontWeight: "600" }}>Anything to add?</Text>
        <TextInput
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={1000}
          placeholder="What went well, and what would help another student decide."
          placeholderTextColor={palette.muted}
          accessibilityLabel="Your review"
          style={{
            minHeight: 110,
            textAlignVertical: "top",
            borderWidth: 1,
            borderColor: palette.hairlineStrong,
            borderRadius: radius.md,
            padding: spacing.md,
            fontSize: 16,
            color: palette.foreground,
            backgroundColor: palette.surface,
          }}
        />
        <Body muted size={13}>
          Reviews are public and can&apos;t be edited once submitted. Your tutor may reply once.
        </Body>

        {submit.error ? (
          <Text accessibilityRole="alert" style={{ color: palette.danger }}>
            {submit.error}
          </Text>
        ) : null}

        <Button
          onPress={async () => {
            const result = await submit.run({ rating, comment: comment.trim() });
            if (result) setDone(result.message ?? "Your review is live.");
          }}
          busy={submit.busy}
          disabled={rating === 0}
        >
          {submit.busy ? "Posting…" : "Post review"}
        </Button>
      </Card>
    </Screen>
  );
}
