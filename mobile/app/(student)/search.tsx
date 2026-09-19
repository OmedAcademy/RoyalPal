import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { api } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { Screen, Heading, Loading, ErrorState, EmptyState, usePalette, Button } from "@/components/ui";
import { TutorCard } from "@/components/TutorCard";
import { spacing, radius, MIN_TOUCH_TARGET } from "@/lib/theme";
import type { TutorPage } from "@/lib/api";

export default function SearchScreen() {
  const palette = usePalette();
  const [query, setQuery] = useState("");
  // Committed separately from the input so every keystroke is not a request —
  // on a mobile connection that is both slow and expensive.
  const [committed, setCommitted] = useState("");
  const [page, setPage] = useState(0);

  const path = `/api/v1/tutors?page=${page}${committed ? `&q=${encodeURIComponent(committed)}` : ""}`;
  const state = useApi<TutorPage>(path, [committed, page]);

  const toggle = useMutation(
    useCallback(async (tutorId: string) => api.post("/api/v1/favorites", { tutorId }), []),
  );

  async function onToggleFavorite(tutorId: string) {
    await toggle.run(tutorId);
    state.refresh();
  }

  return (
    <Screen refreshing={state.refreshing} onRefresh={state.refresh}>
      <Heading>Find a tutor</Heading>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => {
            setPage(0);
            setCommitted(query.trim());
          }}
          returnKeyType="search"
          placeholder="Name or subject"
          placeholderTextColor={palette.muted}
          accessibilityLabel="Search tutors"
          style={{
            flex: 1,
            minHeight: MIN_TOUCH_TARGET,
            borderWidth: 1,
            borderColor: palette.hairlineStrong,
            borderRadius: radius.pill,
            paddingHorizontal: spacing.lg,
            color: palette.foreground,
            backgroundColor: palette.surface,
            fontSize: 16,
          }}
        />
        <Pressable
          onPress={() => {
            setPage(0);
            setCommitted(query.trim());
          }}
          accessibilityRole="button"
          accessibilityLabel="Search"
          style={{
            minHeight: MIN_TOUCH_TARGET,
            paddingHorizontal: spacing.lg,
            borderRadius: radius.pill,
            backgroundColor: palette.royal,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: palette.royalContrast, fontWeight: "600" }}>Search</Text>
        </Pressable>
      </View>

      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.retryable ? state.reload : undefined} />
      ) : (state.data?.tutors.length ?? 0) === 0 ? (
        <EmptyState
          title="No tutors match that"
          message={
            committed
              ? `Nothing matched “${committed}”. Try a different name or subject.`
              : "There are no approved tutors to show yet."
          }
          action={
            committed ? (
              <Button
                variant="secondary"
                onPress={() => {
                  setQuery("");
                  setCommitted("");
                  setPage(0);
                }}
              >
                Clear search
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Text style={{ color: palette.muted, fontSize: 13 }}>
            {state.data!.total} tutor{state.data!.total === 1 ? "" : "s"}
          </Text>
          {state.data!.tutors.map((tutor) => (
            <TutorCard key={tutor.id} tutor={tutor} onToggleFavorite={onToggleFavorite} />
          ))}
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
            {page > 0 ? (
              <Button variant="secondary" onPress={() => setPage((p) => p - 1)}>
                Previous
              </Button>
            ) : (
              <View />
            )}
            {state.data!.hasMore ? (
              <Button variant="secondary" onPress={() => setPage((p) => p + 1)}>
                Next
              </Button>
            ) : (
              <View />
            )}
          </View>
        </>
      )}
    </Screen>
  );
}
