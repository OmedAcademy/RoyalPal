import { useCallback } from "react";
import { router, Stack } from "expo-router";
import { api } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import {
  Screen,
  Heading,
  Loading,
  ErrorState,
  EmptyState,
  Button,
  STACK_EDGES,
} from "@/components/ui";
import { TutorCard } from "@/components/TutorCard";
import type { TutorSummary } from "@/lib/api";

type Response = { tutors: TutorSummary[]; total: number };

export default function SavedTutorsScreen() {
  const state = useApi<Response>("/api/v1/favorites");
  const toggle = useMutation(
    useCallback(async (tutorId: string) => api.post("/api/v1/favorites", { tutorId }), []),
  );

  return (
    <Screen edges={STACK_EDGES} refreshing={state.refreshing} onRefresh={state.refresh}>
      <Stack.Screen options={{ title: "Saved tutors", headerShown: true }} />
      <Heading>Saved tutors</Heading>

      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.retryable ? state.reload : undefined} />
      ) : (state.data?.tutors.length ?? 0) === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          message="Tap the heart on any tutor to keep them one tap away."
          action={<Button onPress={() => router.push("/(student)/search")}>Find a tutor</Button>}
        />
      ) : (
        state.data!.tutors.map((tutor) => (
          <TutorCard
            key={tutor.id}
            tutor={{ ...tutor, favorited: true }}
            onToggleFavorite={async (tutorId) => {
              await toggle.run(tutorId);
              state.refresh();
            }}
          />
        ))
      )}
    </Screen>
  );
}
