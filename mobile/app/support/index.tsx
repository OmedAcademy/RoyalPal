import { useCallback, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { router, Stack } from "expo-router";
import { api } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import {
  Screen,
  Heading,
  Body,
  Card,
  Field,
  Button,
  Badge,
  Loading,
  ErrorState,
  usePalette,
  Divider,
} from "@/components/ui";
import { formatRelativeShort } from "@/lib/format";
import { spacing, radius, MIN_TOUCH_TARGET } from "@/lib/theme";
import type { Ticket } from "@/lib/api";

type Response = { tickets: Ticket[] };

const CATEGORIES = [
  { value: "booking", label: "A lesson" },
  { value: "payment", label: "Payments" },
  { value: "account", label: "My account" },
  { value: "technical", label: "Something broken" },
  { value: "report_user", label: "Report a person" },
  { value: "safeguarding", label: "Safety concern" },
  { value: "other", label: "Something else" },
];

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_user: "Waiting on you",
  resolved: "Resolved",
  closed: "Closed",
};

export default function SupportScreen() {
  const palette = usePalette();
  const state = useApi<Response>("/api/v1/support");
  const [category, setCategory] = useState("booking");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);

  const create = useMutation(
    useCallback(
      async (payload: { category: string; subject: string; body: string }) =>
        api.post<{ ticketId: string | null }>("/api/v1/support", payload),
      [],
    ),
  );

  async function onSubmit() {
    const result = await create.run({ category, subject: subject.trim(), body: body.trim() });
    if (result) {
      setSubject("");
      setBody("");
      setSent(true);
      state.refresh();
    }
  }

  return (
    <Screen refreshing={state.refreshing} onRefresh={state.refresh}>
      <Stack.Screen options={{ title: "Support", headerShown: true }} />
      <Heading>Support</Heading>
      <Body muted>
        Tell us what&apos;s going on and we&apos;ll pick it up. You&apos;ll get a notification when
        we reply.
      </Body>

      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : (state.data?.tickets.length ?? 0) > 0 ? (
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: palette.hairline,
            overflow: "hidden",
          }}
        >
          {state.data!.tickets.map((ticket, index) => (
            <View key={ticket.id}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                onPress={() => router.push(`/support/${ticket.id}`)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.md,
                  padding: spacing.lg,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontWeight: "600", color: palette.foreground }}>
                    {ticket.subject}
                  </Text>
                  <Text style={{ color: palette.muted, fontSize: 13 }}>
                    {formatRelativeShort(ticket.lastMessageAt)}
                  </Text>
                </View>
                <Badge label={STATUS_LABELS[ticket.status] ?? ticket.status} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Card>
        <Text style={{ fontWeight: "600" }}>Open a request</Text>

        {sent ? (
          <Text accessibilityRole="alert" style={{ color: palette.success }}>
            Sent. We&apos;ll be in touch.
          </Text>
        ) : null}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {CATEGORIES.map((option) => {
            const active = category === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setCategory(option.value)}
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
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Field
          label="Title"
          value={subject}
          onChangeText={setSubject}
          maxLength={200}
          placeholder="A short summary"
        />
        <Field
          label="What happened?"
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={5000}
          placeholder="Dates, lesson times, what you expected."
        />

        {create.error ? (
          <Text accessibilityRole="alert" style={{ color: palette.danger }}>
            {create.error}
          </Text>
        ) : null}

        <Button onPress={onSubmit} busy={create.busy} disabled={!subject.trim() || !body.trim()}>
          Send request
        </Button>
      </Card>

      <Body muted>
        If someone is in immediate danger, contact your local emergency services — RoyalPal support
        is not an emergency service.
      </Body>
    </Screen>
  );
}
