import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  Pressable,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { useAuth } from "@/lib/auth";
import { Loading, ErrorState, Button, usePalette } from "@/components/ui";
import { formatTimeIn, formatDateTimeIn } from "@/lib/format";
import { spacing, radius, MIN_TOUCH_TARGET } from "@/lib/theme";
import type { ConversationSummary, Message } from "@/lib/api";

type Response = {
  conversation: ConversationSummary;
  messages: Message[];
  hasMore: boolean;
  nextCursor: string | null;
  timezone: string;
};

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  // Opening a thread marks it read server-side, so the unread badge is stale
  // the moment this screen renders. Re-reading `me` is what moves it.
  const { refresh: refreshBadges } = useAuth();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  // Pages fetched by "load earlier", oldest first. Held here rather than in
  // useApi because useApi replaces its data on every focus refresh, and the
  // newest page is exactly what that refresh should replace.
  const [earlier, setEarlier] = useState<Message[]>([]);
  const [earlierCursor, setEarlierCursor] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  const state = useApi<Response>(id ? `/api/v1/conversations/${id}` : null, [id]);

  const loaded = state.data !== null;
  useEffect(() => {
    if (loaded) void refreshBadges();
  }, [loaded, refreshBadges]);

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

  async function loadEarlier() {
    const cursor = earlierCursor ?? state.data?.nextCursor;
    if (!cursor || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const page = await api.get<Response>(
        `/api/v1/conversations/${id}?before=${encodeURIComponent(cursor)}`,
      );
      setEarlier((current) => [...page.messages, ...current]);
      setEarlierCursor(page.hasMore ? page.nextCursor : null);
    } catch {
      // Left silent on purpose: the thread the reader came for is already on
      // screen, and a failed reach for history is not worth replacing it with
      // an error state.
    } finally {
      setLoadingEarlier(false);
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

  const { conversation, timezone } = state.data;
  const messages = [...earlier, ...state.data.messages];
  const moreToLoad = earlierCursor !== null || (earlier.length === 0 && state.data.hasMore);
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
          onContentSizeChange={() => {
            // Only while the newest page is what is on screen. Once someone
            // has paged into history, snapping back to the bottom throws away
            // the exact thing they just reached for.
            if (earlier.length === 0) scrollRef.current?.scrollToEnd({ animated: false });
          }}
        >
          <Text style={{ color: palette.muted, fontSize: 12, textAlign: "center" }}>
            {conversation.subjectName ?? "Lesson"} ·{" "}
            {formatDateTimeIn(conversation.lessonStartAt, timezone)}
          </Text>

          {moreToLoad ? (
            <Pressable
              onPress={loadEarlier}
              disabled={loadingEarlier}
              accessibilityRole="button"
              accessibilityLabel="Load earlier messages"
              style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }}
            >
              <Text style={{ color: palette.royal, fontWeight: "600" }}>
                {loadingEarlier ? "Loading…" : "Load earlier messages"}
              </Text>
            </Pressable>
          ) : null}

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
            style={{
              color: palette.danger,
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.sm,
            }}
          >
            {send.error}
          </Text>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
