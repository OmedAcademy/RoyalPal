import { useState } from "react";
import { View, Text, Pressable, Image } from "react-native";
import { router } from "expo-router";
import { useApi } from "@/lib/useApi";
import {
  Screen,
  Heading,
  Loading,
  ErrorState,
  EmptyState,
  usePalette,
  Divider,
} from "@/components/ui";
import { formatRelativeShort, formatDateTimeIn } from "@/lib/format";
import { spacing } from "@/lib/theme";
import type { ConversationSummary } from "@/lib/api";

type Response = {
  conversations: ConversationSummary[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  timezone: string;
};

/**
 * Shared by both roles' Messages tab — a conversation looks the same from
 * either side, so one component renders both rather than two that drift.
 */
export function ConversationsList({ emptyMessage }: { emptyMessage: string }) {
  const palette = usePalette();
  // Paged rather than capped. Previous/next rather than an infinite list:
  // useApi replaces its data on every focus refresh, and an accumulator that
  // silently resets under the reader is worse than a control they drive.
  const [page, setPage] = useState(0);
  const state = useApi<Response>(`/api/v1/conversations?page=${page}`, [page]);
  const hasMore = state.data?.hasMore ?? false;

  return (
    <Screen refreshing={state.refreshing} onRefresh={state.refresh}>
      <Heading>Messages</Heading>

      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.retryable ? state.reload : undefined} />
      ) : (state.data?.conversations.length ?? 0) === 0 && page === 0 ? (
        <EmptyState title="No conversations yet" message={emptyMessage} />
      ) : (
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: palette.hairline,
            overflow: "hidden",
          }}
        >
          {state.data!.conversations.map((conversation, index) => (
            <View key={conversation.id}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                onPress={() => router.push(`/messages/${conversation.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Conversation with ${conversation.counterpartName}${
                  conversation.unreadCount > 0 ? `, ${conversation.unreadCount} unread` : ""
                }`}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.md,
                  padding: spacing.lg,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                {conversation.counterpartAvatarUrl ? (
                  <Image
                    source={{ uri: conversation.counterpartAvatarUrl }}
                    accessibilityIgnoresInvertColors
                    style={{ width: 44, height: 44, borderRadius: 22 }}
                  />
                ) : (
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: palette.hairline,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontWeight: "600", color: palette.muted }}>
                      {conversation.counterpartName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}

                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                    <Text
                      numberOfLines={1}
                      style={{ fontWeight: "600", flex: 1, color: palette.foreground }}
                    >
                      {conversation.counterpartName}
                    </Text>
                    {conversation.lastMessageAt ? (
                      <Text style={{ color: palette.muted, fontSize: 12 }}>
                        {formatRelativeShort(conversation.lastMessageAt)}
                      </Text>
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={{ color: palette.muted, fontSize: 14 }}>
                    {conversation.lastMessagePreview ??
                      `${conversation.subjectName ?? "Lesson"} · ${formatDateTimeIn(
                        conversation.lessonStartAt,
                        state.data!.timezone,
                      )}`}
                  </Text>
                </View>

                {conversation.unreadCount > 0 ? (
                  <View
                    style={{
                      backgroundColor: palette.royal,
                      borderRadius: 999,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      minWidth: 24,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: palette.royalContrast, fontSize: 12, fontWeight: "700" }}>
                      {conversation.unreadCount > 9 ? "9+" : conversation.unreadCount}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {page > 0 || hasMore ? (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: spacing.md,
            marginTop: spacing.lg,
          }}
        >
          <Pressable
            onPress={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            accessibilityRole="button"
            accessibilityLabel="Previous page of conversations"
            accessibilityState={{ disabled: page === 0 }}
            style={{ minHeight: 44, justifyContent: "center", opacity: page === 0 ? 0.35 : 1 }}
          >
            <Text style={{ color: palette.royal, fontWeight: "600" }}>← Previous</Text>
          </Pressable>

          <Text style={{ color: palette.muted, fontSize: 13 }}>Page {page + 1}</Text>

          <Pressable
            onPress={() => setPage((p) => p + 1)}
            disabled={!hasMore}
            accessibilityRole="button"
            accessibilityLabel="Next page of conversations"
            accessibilityState={{ disabled: !hasMore }}
            style={{ minHeight: 44, justifyContent: "center", opacity: hasMore ? 1 : 0.35 }}
          >
            <Text style={{ color: palette.royal, fontWeight: "600" }}>Next →</Text>
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}
