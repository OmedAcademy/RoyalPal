import { View, Text, Pressable } from "react-native";
import { usePalette } from "@/components/ui";
import { spacing, radius, MIN_TOUCH_TARGET } from "@/lib/theme";
import type { AvailabilityDay } from "@/lib/api";

/**
 * Day-grouped time chips, shared by the booking and reschedule screens so the
 * two cannot drift into offering slots differently.
 *
 * The days and their labels are computed by the SERVER, in the account's own
 * time zone — a phone's clock and locale belong to its owner and can be wrong.
 * This component renders what it is given and derives no dates itself.
 */
export function SlotPicker({
  days,
  selected,
  onSelect,
  timezoneLabel,
}: {
  days: AvailabilityDay[];
  selected: string | null;
  onSelect: (startAt: string) => void;
  timezoneLabel?: string;
}) {
  const palette = usePalette();

  return (
    <View style={{ gap: spacing.lg }} accessibilityRole="radiogroup">
      {timezoneLabel ? (
        <Text style={{ color: palette.muted, fontSize: 13 }}>Times shown in {timezoneLabel}.</Text>
      ) : null}

      {days.map((day) => (
        <View key={day.date} style={{ gap: spacing.sm }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: palette.muted }}>
            {day.label.toUpperCase()}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {day.slots.map((option) => {
              const active = selected === option.startAt;
              return (
                <Pressable
                  key={option.startAt}
                  onPress={() => onSelect(option.startAt)}
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
      ))}
    </View>
  );
}
