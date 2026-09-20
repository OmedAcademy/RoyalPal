import { useCallback, useState } from "react";
import { View, Text } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
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
  STACK_EDGES,
} from "@/components/ui";
import { formatRelativeShort } from "@/lib/format";
import { spacing } from "@/lib/theme";

type TicketMessage = {
  id: string;
  body: string;
  fromAdmin: boolean;
  senderName: string;
  createdAt: string;
};
type Response = {
  ticket: { id: string; subject: string; status: string; category: string };
  messages: TicketMessage[];
};

export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const [draft, setDraft] = useState("");
  const state = useApi<Response>(id ? `/api/v1/support/${id}` : null, [id]);

  const reply = useMutation(
    useCallback(async (body: string) => api.post(`/api/v1/support/${id}`, { body }), [id]),
  );

  if (state.loading) return <Loading />;
  if (state.error || !state.data) {
    return (
      <Screen edges={STACK_EDGES}>
        <ErrorState
          message={state.error ?? "That request isn't available."}
          onRetry={state.retryable ? state.reload : undefined}
        />
      </Screen>
    );
  }

  const { ticket, messages } = state.data;
  const closed = ticket.status === "closed";

  return (
    <Screen refreshing={state.refreshing} onRefresh={state.refresh}>
      <Stack.Screen options={{ title: "Support request", headerShown: true }} />
      <View style={{ gap: spacing.xs }}>
        <Heading>{ticket.subject}</Heading>
        <Badge label={ticket.status.replace("_", " ")} />
      </View>

      {messages.length === 0 ? (
        <Card>
          <Body muted>
            This request was opened but its first message didn&apos;t save. Add it below and our
            team will pick it up.
          </Body>
        </Card>
      ) : null}

      {messages.map((message) => (
        <Card key={message.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontWeight: "600", color: palette.foreground }}>
              {message.senderName}
            </Text>
            <Text style={{ color: palette.muted, fontSize: 12 }}>
              {formatRelativeShort(message.createdAt)}
            </Text>
          </View>
          <Body>{message.body}</Body>
        </Card>
      ))}

      {closed ? (
        <Body muted>This request is closed. Open a new one if you still need help.</Body>
      ) : (
        <Card>
          <Field
            label="Reply"
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={5000}
            placeholder="Anything else that might help…"
          />
          {reply.error ? (
            <Text accessibilityRole="alert" style={{ color: palette.danger }}>
              {reply.error}
            </Text>
          ) : null}
          <Button
            onPress={async () => {
              const result = await reply.run(draft.trim());
              if (result !== null) {
                setDraft("");
                state.refresh();
              }
            }}
            busy={reply.busy}
            disabled={!draft.trim()}
          >
            Send reply
          </Button>
        </Card>
      )}
    </Screen>
  );
}
