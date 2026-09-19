import { Text, type ColorValue } from "react-native";

/**
 * Tab glyphs.
 *
 * Text glyphs rather than an icon font or SVG package: five icons do not
 * justify a dependency, and the tab label below each one carries the
 * accessible name, so these are purely decorative.
 */
const GLYPHS = {
  home: "⌂",
  search: "⌕",
  lessons: "▤",
  saved: "♡",
  messages: "✉",
  profile: "☺",
  calendar: "▦",
  reviews: "★",
} as const;

export type TabIconName = keyof typeof GLYPHS;

// `color` is typed ColorValue rather than string because that is what the
// tab bar passes — React Native can hand back an opaque platform colour, not
// only a hex string.
export function TabIcon({ name, color }: { name: TabIconName; color: ColorValue }) {
  return (
    <Text allowFontScaling={false} accessibilityElementsHidden importantForAccessibility="no" style={{ fontSize: 20, color, lineHeight: 24 }}>
      {GLYPHS[name]}
    </Text>
  );
}
