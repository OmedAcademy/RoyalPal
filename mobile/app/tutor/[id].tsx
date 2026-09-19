import { useCallback } from "react";
import { View, Text, Linking } from "react-native";
import { useLocalSearchParams, router, Stack } from "expo-router";
import { api } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import {
  Screen,
  Heading,
  Body,
  Card,
  Button,
  Badge,
  Loading,
  ErrorState,
  usePalette,
} from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { spacing } from "@/lib/theme";
import type { TutorSummary } from "@/lib/api";

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  author_name?: string;
  tutor_reply?: string | null;
};

type Response = {
  tutor: TutorSummary;
  subjects: { id: number; name: string }[];
  reviews: Review[];
  favorited: boolean;
};

export default function TutorProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const state = useApi<Response>(id ? `/api/v1/tutors/${id}` : null, [id]);

  const toggle = useMutation(
    useCallback(async (tutorId: string) => api.post("/api/v1/favorites", { tutorId }), []),
  );

  if (state.loading) return <Loading />;
  if (state.error || !state.data) {
    return (
      <Screen>
        <ErrorState
          message={state.error ?? "That tutor isn't available."}
          onRetry={state.retryable ? state.reload : undefined}
        />
      </Screen>
    );
  }

  const { tutor, subjects, reviews, favorited } = state.data;

  return (
    <Screen refreshing={state.refreshing} onRefresh={state.refresh}>
      <Stack.Screen options={{ title: tutor.full_name }} />

      <View style={{ gap: spacing.xs }}>
        <Heading>{tutor.full_name}</Heading>
        <Body muted>{tutor.headline}</Body>
        {tutor.avg_rating !== null ? (
          <Text style={{ color: palette.muted }}>
            ★ {tutor.avg_rating.toFixed(1)} · {tutor.total_reviews} review
            {tutor.total_reviews === 1 ? "" : "s"}
          </Text>
        ) : (
          <Badge label="No reviews yet" />
        )}
      </View>

      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View>
            <Body muted>Hourly</Body>
            <Text style={{ fontWeight: "700", fontSize: 18, color: palette.foreground }}>
              {formatMoney(tutor.hourly_rate_cents, tutor.currency)}
            </Text>
          </View>
          {tutor.trial_price_cents !== null ? (
            <View>
              <Body muted>Trial (30 min)</Body>
              <Text style={{ fontWeight: "700", fontSize: 18, color: palette.foreground }}>
                {formatMoney(tutor.trial_price_cents, tutor.currency)}
              </Text>
            </View>
          ) : null}
        </View>

        {!tutor.stripe_charges_enabled ? (
          <Body muted>
            This tutor isn&apos;t accepting payments for standard lessons yet
            {tutor.trial_price_cents !== null ? " — a trial lesson is still bookable." : "."}
          </Body>
        ) : null}

        <Button onPress={() => router.push(`/book/${tutor.id}`)}>Book a lesson</Button>
        <Button
          variant="secondary"
          busy={toggle.busy}
          onPress={async () => {
            await toggle.run(tutor.id);
            state.refresh();
          }}
        >
          {favorited ? "♥ Saved" : "♡ Save tutor"}
        </Button>
      </Card>

      {tutor.bio ? (
        <Card>
          <Text style={{ fontWeight: "600" }}>About</Text>
          <Body>{tutor.bio}</Body>
        </Card>
      ) : null}

      {subjects.length > 0 ? (
        <Card>
          <Text style={{ fontWeight: "600" }}>Subjects</Text>
          <Body muted>{subjects.map((s) => s.name).join(" · ")}</Body>
        </Card>
      ) : null}

      {tutor.teaching_languages.length > 0 ? (
        <Card>
          <Text style={{ fontWeight: "600" }}>Teaches in</Text>
          <Body muted>{tutor.teaching_languages.join(" · ")}</Body>
        </Card>
      ) : null}

      {tutor.video_url ? (
        <Button variant="secondary" onPress={() => Linking.openURL(tutor.video_url!)}>
          Watch intro video
        </Button>
      ) : null}

      {reviews.length > 0 ? (
        <Card>
          <Text style={{ fontWeight: "600" }}>Reviews</Text>
          {reviews.slice(0, 10).map((review) => (
            <View key={review.id} style={{ gap: 2, paddingVertical: spacing.xs }}>
              <Text style={{ color: palette.foreground }}>
                {"★".repeat(review.rating)}
                <Text style={{ color: palette.muted }}>{"★".repeat(5 - review.rating)}</Text>
              </Text>
              {review.comment ? <Body muted>{review.comment}</Body> : null}
              {review.tutor_reply ? (
                <Text style={{ color: palette.muted, fontStyle: "italic", fontSize: 13 }}>
                  Reply: {review.tutor_reply}
                </Text>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
