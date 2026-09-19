import { useMemo, useState } from "react";
import { View, Text, Pressable, Modal, FlatList, TextInput, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePalette, Button, Body } from "@/components/ui";
import { spacing, radius, MIN_TOUCH_TARGET } from "@/lib/theme";

export type Choice = { value: string; label: string; group?: string };

/**
 * Picking from a long list on a phone.
 *
 * The web forms use a `<select>` or a checkbox grid, neither of which has a
 * native equivalent that works the same on both platforms — iOS renders a
 * wheel, Android a dropdown, and multi-select has no built-in at all. A sheet
 * with a filter box behaves identically on both and stays usable at the
 * thousand-odd entries the timezone and language lists reach.
 *
 * The lists themselves come from GET /api/v1/reference, so a subject added in
 * the admin tool appears here without an app release.
 */
export function Chooser({
  label,
  hint,
  choices,
  selected,
  onChange,
  multiple = false,
  placeholder = "Choose…",
}: {
  label: string;
  hint?: string;
  choices: Choice[];
  selected: string[];
  onChange: (next: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
}) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const byValue = useMemo(() => new Map(choices.map((c) => [c.value, c.label])), [choices]);
  const summary = selected.length
    ? selected.map((value) => byValue.get(value) ?? value).join(", ")
    : placeholder;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return choices;
    return choices.filter(
      (choice) =>
        choice.label.toLowerCase().includes(needle) ||
        choice.value.toLowerCase().includes(needle) ||
        choice.group?.toLowerCase().includes(needle),
    );
  }, [choices, query]);

  const toggle = (value: string) => {
    if (!multiple) {
      onChange([value]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ fontSize: 14, fontWeight: "600", color: palette.foreground }}>{label}</Text>
      <Pressable
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${selected.length ? summary : "Nothing chosen"}`}
        style={{
          minHeight: MIN_TOUCH_TARGET,
          justifyContent: "center",
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: palette.hairlineStrong,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
          backgroundColor: palette.surface,
        }}
      >
        <Text style={{ fontSize: 16, color: selected.length ? palette.foreground : palette.muted }}>
          {summary}
        </Text>
      </Pressable>
      {hint ? <Text style={{ fontSize: 12, color: palette.muted }}>{hint}</Text> : null}

      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
          <View style={{ padding: spacing.lg, gap: spacing.md, flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: palette.foreground }}>
              {label}
            </Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
              placeholderTextColor={palette.muted}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel={`Search ${label}`}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: palette.hairlineStrong,
                borderRadius: radius.md,
                paddingHorizontal: spacing.md,
                fontSize: 16,
                color: palette.foreground,
                backgroundColor: palette.surface,
              }}
            />
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Body muted>No matches. Try a shorter search.</Body>}
              renderItem={({ item }) => {
                const active = selected.includes(item.value);
                return (
                  <Pressable
                    onPress={() => toggle(item.value)}
                    accessibilityRole={multiple ? "checkbox" : "radio"}
                    accessibilityState={{ checked: active, selected: active }}
                    style={{
                      minHeight: MIN_TOUCH_TARGET,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: spacing.md,
                      paddingVertical: spacing.md,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: palette.hairline,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, color: palette.foreground }}>{item.label}</Text>
                      {item.group ? (
                        <Text style={{ fontSize: 12, color: palette.muted }}>{item.group}</Text>
                      ) : null}
                    </View>
                    <Text style={{ fontSize: 18, color: active ? palette.royal : "transparent" }}>
                      ✓
                    </Text>
                  </Pressable>
                );
              }}
            />
            <Button onPress={() => setOpen(false)}>Done</Button>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
