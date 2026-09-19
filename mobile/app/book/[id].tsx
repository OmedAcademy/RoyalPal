import { useCallback, useState } from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { api } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { Screen, Heading, Body, Card, Button, Loading, ErrorState, EmptyState, usePalette } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { spacing, radius, MIN_TOUCH_TARGET } from "@/lib/theme";
import type { AvailabilityDay, TutorSummary } from "@/lib/api";

type TutorResponse = { tutor: TutorSummary; subjects: { id: number; name: string }[] };
type AvailabilityResponse = { timezone: string; durationMinutes: number; days: AvailabilityDay[] };

export default function BookLessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();

  const [lessonType, setLessonType] = useState<"standard" | "trial">("standard");
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [slot, setSlot] = useState<string | null>(null);

  const duration = lessonType === "trial" ? 30 : 60;
  const tutorState = useApi<TutorResponse>(id ? `/api/v1/tutors/${id}` : null, [id]);
  const slotsState = useApi<AvailabilityResponse>(
    id ? `/api/v1/tutors/${id}/availability?durationMinutes=${duration}` : null,
    [id, duration],
  );

  const book = useMutation(
    useCallback(
      async (payload: {
        tutorId: string;
        subjectId: number;
        startAt: string;
        durationMinutes: number;
        lessonType: string;
      }) => api.post<{ ok: boolean; checkoutUrl?: string }>("/api/v1/bookings", payload),
      [],
    ),
  );

  if (tutorState.loading) return <Loading />;
  if (tutorState.error || !tutorState.data) {
    return (
      <Screen>
        <ErrorState message={tutorState.error ?? "Couldn't load that tutor."} onRetry={tutorState.reload} />
      </Screen>
    );
  }

  const { tutor, subjects } = tutorState.data;
  const price = lessonType === "trial" ? tutor.trial_price_cents : tutor.hourly_rate_cents;
  const chosenSubject = subjectId ?? subjects[0]?.id ?? null;

  async function onBook() {
    if (!chosenSubject || !slot || !id) return;

    const result = await book.run({
      tutorId: id,
      subjectId: chosenSubject,
      startAt: slot,
      durationMinutes: duration,
      lessonType,
    });

    if (!result) return;

    if (result.checkoutUrl) {
      // Opened in the system browser rather than an in-app webview. Card
      // autofill, 3-D Secure challenges and Stripe's own fraud signals all
      // depend on a real browser session; a webview silently degrades all
      // three and gets payments declined.
      await WebBrowser.openBrowserAsync(result.checkoutUrl);
      router.replace("/(student)/lessons");
      return;
    }

    Alert.alert("Booked", "Your lesson has been reserved.", [
      { text: "OK", onPress: () => router.replace("/(student)/lessons") },
    ]);
  }

  return (
    <Screen>
      <Heading>Book with {tutor.full_name}</Heading>

      <Card>
        <Text style={{ fontWeight: "600" }}>Lesson type</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {(["standard", "trial"] as const)
            .filter((type) => type === "standard" || tutor.trial_price_cents !== null)
            .map((type) => {
              const active = lessonType === type;
              const disabled = type === "standard" && !tutor.stripe_charges_enabled;
              return (
                <Pressable
                  key={type}
                  disabled={disabled}
                  onPress={() => {
                    setLessonType(type);
                    setSlot(null);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, disabled }}
                  style={{
                    flex: 1,
                    minHeight: MIN_TOUCH_TARGET,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.md,
                    borderWidth: 1,
                    opacity: disabled ? 0.5 : 1,
                    borderColor: active ? palette.royal : palette.hairlineStrong,
                    backgroundColor: active ? palette.royal : "transparent",
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "600",
                      color: active ? palette.royalContrast : palette.foreground,
                    }}
                  >
                    {type === "trial" ? "Trial · 30 min" : "Standard · 60 min"}
                  </Text>
                </Pressable>
              );
            })}
        </View>
        {price !== null ? (
          <Text style={{ fontWeight: "700", fontSize: 18, color: palette.foreground }}>
            {formatMoney(price, tutor.currency)}
          </Text>
        ) : null}
      </Card>

      {subjects.length > 1 ? (
        <Card>
          <Text style={{ fontWeight: "600" }}>Subject</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {subjects.map((subject) => {
              const active = chosenSubject === subject.id;
              return (
                <Pressable
                  key={subject.id}
                  onPress={() => setSubjectId(subject.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={{
                    minHeight: MIN_TOUCH_TARGET,
                    paddingHorizontal: spacing.lg,
                    justifyContent: "center",
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: active ? palette.royal : palette.hairlineStrong,
                    backgroundColor: active ? palette.royal : "transparent",
                  }}
                >
                  <Text style={{ color: active ? palette.royalContrast : palette.foreground }}>
                    {subject.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}

      <Card>
        <Text style={{ fontWeight: "600" }}>Pick a time</Text>
        {slotsState.data ? (
          <Body muted>Shown in your time zone ({slotsState.data.timezone}).</Body>
        ) : null}

        {slotsState.loading ? (
          <Loading label="Finding open times…" />
        ) : slotsState.error ? (
          <ErrorState message={slotsState.error} onRetry={slotsState.reload} />
        ) : (slotsState.data?.days.length ?? 0) === 0 ? (
          <EmptyState
            title="No open times"
            message="This tutor has no availability at the moment. Try again later or save them for when they do."
          />
        ) : (
          slotsState.data!.days.map((day) => (
            <View key={day.date} style={{ gap: spacing.sm }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: palette.muted }}>
                {day.label.toUpperCase()}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {day.slots.map((option) => {
                  const active = slot === option.startAt;
                  return (
                    <Pressable
                      key={option.startAt}
                      onPress={() => setSlot(option.startAt)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${day.label} at ${option.label}`}
                      style={{
                        minHeight: MIN_TOUCH_TARGET,
                        paddingHorizontal: spacing.lg,
                        justifyContent: "center",
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: active ? palette.royal : palette.hairlineStrong,
                        backgroundColor: active ? palette.royal : "transparent",
                      }}
                    >
                      <Text style={{ color: active ? palette.royalContrast : palette.foreground }}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </Card>

      {book.error ? (
        <Text accessibilityRole="alert" style={{ color: palette.danger }}>
          {book.error}
        </Text>
      ) : null}

      <Button onPress={onBook} busy={book.busy} disabled={!slot || !chosenSubject}>
        {book.busy ? "Reserving…" : "Continue to payment"}
      </Button>
      <Body muted>
        You&apos;ll finish payment in your browser. The slot is held while you do.
      </Body>
    </Screen>
  );
}
