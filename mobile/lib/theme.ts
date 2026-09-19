import { Platform } from "react-native";

/**
 * RoyalPal's design tokens, mirrored from the web app's CSS variables so the
 * two surfaces are recognisably the same product. Kept as plain objects rather
 * than a styling library: the app is small enough that a library would be more
 * API to learn than it saves.
 */
export const colors = {
  royal: "#0F2D52",
  royalContrast: "#FFFDF8",
  gold: "#D4AF37",
  background: "#F8F5EE",
  surface: "#FFFDF8",
  foreground: "#12233D",
  muted: "#6B7688",
  mutedStrong: "#3A4456",
  hairline: "rgba(15,45,82,0.12)",
  hairlineStrong: "rgba(15,45,82,0.22)",
  danger: "#B3261E",
  success: "#1B7A4B",
  warning: "#8A6100",
} as const;

export const darkColors = {
  ...colors,
  background: "#0C1523",
  surface: "#12233D",
  foreground: "#F2EFE6",
  muted: "#93A0B5",
  mutedStrong: "#C3CCDA",
  hairline: "rgba(242,239,230,0.14)",
  hairlineStrong: "rgba(242,239,230,0.26)",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

/**
 * 44pt is Apple's minimum and 48dp is Android's; 48 satisfies both. Every
 * pressable in this app is at least this tall — a tap target you have to aim
 * at is the single most common way a mobile app feels cheap.
 */
export const MIN_TOUCH_TARGET = 48;

export const typography = {
  display: Platform.select({ ios: "Georgia", android: "serif", default: "serif" }),
} as const;
