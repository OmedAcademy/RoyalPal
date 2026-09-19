import { useCallback, useRef, useState } from "react";
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, TextInput } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { Loading, ErrorState, Button, usePalette } from "@/components/ui";
import { formatTimeIn, formatDateTimeIn } from "@/lib/format";
import { spacing, radius, MIN_TOUCH_TARGET } from "@/lib/theme";
import type { ConversationSummary, Message } from "@/lib/api";

type Response = { conversation: ConversationSummary; messages: Message[]; timezone: string };

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const state = useApi<Response>(id ? `/api/v1/conversations/${id}` : null, [id]);

  const send = useMutation(
    useCallback(
      async (body: string) => api.post(`/api/v1/conversations/${id}/messages`, { body }),
      [id],
    ),
  );

  async function onSend() {
    const body = draft.trim();
    if (!body) return;
    const result = await send.run(body);
    // Cleared only on a confirmed send: wiping optimistically loses what
    // someone typed at the exact moment it failed.
    if (result !== null) {
      setDraft("");
      state.refresh();
    }
  }

  if (state.loading) return <Loading />;
  if (state.error || !state.data) {
    return (
      <SafeAreaView style={{ flex: 1, padding: spacing.lg, backgroundColor: palette.background }}>
        <ErrorState
          message={state.error ?? "That conversation isn't available."}
          onRetry={state.retryable ? state.reload : undefined}
        />
      </SafeAreaView>
    );
  }

  const { conversation, messages, timezone } = state.data;
  const closed = conversation.status === "closed";

  return (
    <SafeAreaView edges={["bottom"]} style={{ flex: 1, backgroundColor: palette.background }}>
      <Stack.Screen options={{ title: conversation.counterpartName }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          <Text style={{ color: palette.muted, fontSize: 12, textAlign: "center" }}>
            {conversation.subjectName ?? "Lesson"} ·{" "}
            {formatDateTimeIn(conversation.lessonStartAt, timezone)}
          </Text>

          {messages.length === 0 ? (
            <Text style={{ color: palette.muted, textAlign: "center", marginTop: spacing.xl }}>
              No messages yet. Say hello and agree what you&apos;d like to cover.
            </Text>
          ) : (
            messages.map((message) => (
              <View
                key={message.id}
                style={{ alignItems: message.mine ? "flex-end" : "flex-start" }}
              >
                <View
                  style={{
                    maxWidth: "85%",
                    backgroundColor: message.mine ? palette.royal : palette.surface,
                    borderColor: palette.hairline,
                    borderWidth: message.mine ? 0 : 1,
                    borderRadius: radius.lg,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                  }}
                >
                  <Text
                    style={{ color: message.mine ? palette.royalContrast : palette.foreground }}
                  >
                    {message.body}
                  </Text>
                </View>
                <Text style={{ color: palette.muted, fontSize: 11, marginTop: 2 }}>
                  {formatTimeIn(message.createdAt, timezone)}
                  {message.mine && message.readAt ? " · Read" : ""}
                </Text>
              </View>
            ))
          )}
        </ScrollView>

        {closed ? (
          <View style={{ padding: spacing.lg }}>
            <Text style={{ color: palette.muted, textAlign: "center", fontSize: 13 }}>
              This conversation is closed
              {conversation.closedReason ? ` — ${conversation.closedReason}` : ""}. You can still
              read it.
            </Text>
          </View>
        ) : (
          <View
            style={{
              flexDirection: "row",
              gap: spacing.sm,
              padding: spacing.md,
              borderTopWidth: 1,
              borderTopColor: palette.hairline,
              backgroundColor: palette.surface,
              alignItems: "flex-end",
            }}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a message…"
              placeholderTextColor={palette.muted}
              accessibilityLabel="Write a message"
              multiline
              maxLength={4000}
              style={{
                flex: 1,
                minHeight: MIN_TOUCH_TARGET,
                maxHeight: 120,
                borderWidth: 1,
                borderColor: palette.hairlineStrong,
                borderRadius: radius.lg,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                color: palette.foreground,
                fontSize: 16,
              }}
            />
            <Button onPress={onSend} busy={send.busy} disabled={!draft.trim()}>
              Send
            </Button>
          </View>
        )}

        {send.error ? (
          <Text
            accessibilityRole="alert"
            style={{ color: palette.danger, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
          >
            {send.error}
          </Text>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
