import { useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import { router, Stack } from "expo-router";
import { api } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { Screen, Heading, Body, Loading, ErrorState, EmptyState, Button, usePalette, Divider } from "@/components/ui";
import { formatRelativeShort } from "@/lib/format";
import { spacing } from "@/lib/theme";
import type { NotificationItem } from "@/lib/api";

type Response = { notifications: NotificationItem[]; unreadCount: number };

export default function NotificationsScreen() {
  const palette = usePalette();
  const state = useApi<Response>("/api/v1/notifications");

  const markRead = useMutation(
    useCallback(async (id?: string) => api.post("/api/v1/notifications", id ? { id } : {}), []),
  );

  return (
    <Screen refreshing={state.refreshing} onRefresh={state.refresh}>
      <Stack.Screen options={{ title: "Notifications" }} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Heading>Notifications</Heading>
        {(state.data?.unreadCount ?? 0) > 0 ? (
          <Button
            variant="secondary"
            busy={markRead.busy}
            onPress={async () => {
              await markRead.run(undefined);
              state.refresh();
            }}
          >
            Mark all read
          </Button>
        ) : null}
      </View>

      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.retryable ? state.reload : undefined} />
      ) : (state.data?.notifications.length ?? 0) === 0 ? (
        <EmptyState
          title="Nothing yet"
          message="Lesson confirmations, messages and account updates will appear here."
        />
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
          {state.data!.notifications.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.title}${item.read ? "" : ", unread"}`}
                onPress={async () => {
                  if (!item.read) await markRead.run(item.id);
                  if (item.href) router.push(item.href);
                  else state.refresh();
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  gap: spacing.md,
                  padding: spacing.lg,
                  opacity: pressed ? 0.85 : 1,
                  backgroundColor: item.read ? "transparent" : palette.hairline,
                })}
              >
                <Text style={{ fontSize: 18 }}>{item.icon}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontWeight: item.read ? "500" : "700", color: palette.foreground }}>
                    {item.title}
                  </Text>
                  {item.body ? <Body muted size={14}>{item.body}</Body> : null}
                  <Text style={{ color: palette.muted, fontSize: 12, marginTop: 2 }}>
                    {formatRelativeShort(item.createdAt)}
                  </Text>
                </View>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
