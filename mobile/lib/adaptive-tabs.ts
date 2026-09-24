import { useWindowDimensions, type ViewStyle } from "react-native";
import { usePalette } from "@/components/ui";

/** iPad / Android tablet, including landscape and a wide split view. */
const REGULAR_WIDTH = 768;

/**
 * Compact windows keep the bottom tab bar. Regular windows move it to a
 * left rail so a tablet is not a phone layout stretched across the screen.
 */
export function useAdaptiveTabScreenOptions() {
  const { width } = useWindowDimensions();
  const palette = usePalette();
  const regular = width >= REGULAR_WIDTH;

  const tabBarStyle: ViewStyle = regular
    ? {
        position: "absolute",
        left: 0,
        top: 0,
        width: 220,
        height: "100%",
        backgroundColor: palette.surface,
        borderRightColor: palette.hairline,
        borderRightWidth: 1,
        borderTopWidth: 0,
        paddingTop: 12,
      }
    : {
        backgroundColor: palette.surface,
        borderTopColor: palette.hairline,
      };

  return {
    headerShown: false as const,
    tabBarActiveTintColor: palette.royal,
    tabBarInactiveTintColor: palette.muted,
    tabBarStyle,
    tabBarLabelStyle: {
      fontSize: regular ? 15 : 11,
      fontWeight: "600" as const,
    },
    tabBarItemStyle: regular
      ? ({
          flexDirection: "row",
          justifyContent: "flex-start",
          height: 52,
          paddingHorizontal: 16,
        } as const)
      : undefined,
    sceneStyle: regular ? { marginLeft: 220 } : undefined,
  };
}
