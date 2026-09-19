import { View, Text, Pressable, Image } from "react-native";
import { router } from "expo-router";
import { Card, Badge, usePalette } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { spacing, MIN_TOUCH_TARGET } from "@/lib/theme";
import type { TutorSummary } from "@/lib/api";

export function TutorCard({
  tutor,
  onToggleFavorite,
}: {
  tutor: TutorSummary;
  onToggleFavorite?: (tutorId: string) => void;
}) {
  const palette = usePalette();
  const initial = tutor.full_name.trim().charAt(0).toUpperCase() || "?";

  return (
    <Pressable
      onPress={() => router.push(`/tutor/${tutor.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${tutor.full_name}. ${tutor.headline}. ${formatMoney(tutor.hourly_rate_cents, tutor.currency)} per hour.`}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
    >
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          {tutor.avatar_url ? (
            <Image
              source={{ uri: tutor.avatar_url }}
              accessibilityIgnoresInvertColors
              style={{ width: 52, height: 52, borderRadius: 26 }}
            />
          ) : (
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: palette.hairline,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: "600", color: palette.muted }}>
                {initial}
              </Text>
            </View>
          )}

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontWeight: "600", color: palette.foreground }}>
              {tutor.full_name}
            </Text>
            <Text numberOfLines={1} style={{ color: palette.muted, fontSize: 14 }}>
              {tutor.headline}
            </Text>
          </View>

          {onToggleFavorite ? (
            <Pressable
              onPress={() => onToggleFavorite(tutor.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: Boolean(tutor.favorited) }}
              accessibilityLabel={
                tutor.favorited
                  ? `Remove ${tutor.full_name} from saved tutors`
                  : `Save ${tutor.full_name}`
              }
              hitSlop={12}
              style={{
                width: MIN_TOUCH_TARGET,
                height: MIN_TOUCH_TARGET,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{ fontSize: 22, color: tutor.favorited ? palette.royal : palette.muted }}
              >
                {tutor.favorited ? "♥" : "♡"}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.sm,
          }}
        >
          <Text style={{ fontWeight: "600", color: palette.foreground }}>
            {formatMoney(tutor.hourly_rate_cents, tutor.currency)}
            <Text style={{ color: palette.muted, fontWeight: "400" }}>/hr</Text>
          </Text>
          {tutor.avg_rating !== null ? (
            <Text style={{ color: palette.muted, fontSize: 14 }}>
              ★ {tutor.avg_rating.toFixed(1)} ({tutor.total_reviews})
            </Text>
          ) : (
            <Badge label="New" />
          )}
        </View>
      </Card>
    </Pressable>
  );
}
