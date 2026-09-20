import { forwardRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, darkColors, radius, spacing, MIN_TOUCH_TARGET, typography } from "@/lib/theme";

export function usePalette() {
  return useColorScheme() === "dark" ? darkColors : colors;
}

/**
 * The frame every screen sits in.
 *
 * `edges` excludes the bottom by default because the tab bar already owns that
 * inset — applying it twice leaves a visible dead band above the bar. Screens
 * pushed onto a stack (no tab bar) pass the bottom edge themselves, which this
 * comment described for some time before the prop existed: the value was
 * hard-coded, so every pushed screen rendered its last button under the home
 * indicator.
 */
/** Every edge, for a screen pushed onto a stack: there is no tab bar below it
 * to own the bottom inset, so the screen owns it. */
export const STACK_EDGES = ["top", "bottom", "left", "right"] as const;

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  contentStyle,
  edges = ["top", "left", "right"],
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: ViewStyle;
  /** Safe-area edges to apply. Default omits the bottom, which the tab bar
   * owns; a stack-pushed screen passes STACK_EDGES. */
  edges?: readonly ("top" | "bottom" | "left" | "right")[];
}) {
  const palette = usePalette();
  const body = (
    <View style={[{ padding: spacing.lg, gap: spacing.lg, flexGrow: 1 }, contentStyle]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: palette.background }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} />
            ) : undefined
          }
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

export function Heading({ children, level = 1 }: { children: ReactNode; level?: 1 | 2 }) {
  const palette = usePalette();
  return (
    <Text
      accessibilityRole="header"
      style={{
        fontFamily: level === 1 ? typography.display : undefined,
        fontSize: level === 1 ? 26 : 17,
        fontWeight: level === 1 ? "600" : "700",
        color: palette.foreground,
      }}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted = false,
  size = 15,
}: {
  children: ReactNode;
  muted?: boolean;
  size?: number;
}) {
  const palette = usePalette();
  return (
    <Text
      style={{
        fontSize: size,
        lineHeight: size * 1.45,
        color: muted ? palette.muted : palette.foreground,
      }}
    >
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const palette = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: palette.surface,
          borderColor: palette.hairline,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderRadius: radius.lg,
          padding: spacing.lg,
          gap: spacing.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Button({
  children,
  onPress,
  variant = "primary",
  disabled = false,
  busy = false,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
}) {
  const palette = usePalette();
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH_TARGET,
        paddingHorizontal: spacing.xl,
        borderRadius: radius.pill,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: spacing.sm,
        opacity: disabled || busy ? 0.55 : pressed ? 0.85 : 1,
        backgroundColor: isPrimary ? palette.royal : isDanger ? palette.danger : "transparent",
        borderWidth: isPrimary || isDanger ? 0 : StyleSheet.hairlineWidth * 2,
        borderColor: palette.hairlineStrong,
      })}
    >
      {busy && (
        <ActivityIndicator
          size="small"
          color={isPrimary || isDanger ? "#fff" : palette.foreground}
        />
      )}
      <Text
        style={{
          fontSize: 15,
          fontWeight: "600",
          color: isPrimary || isDanger ? "#FFFDF8" : palette.foreground,
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}

export const Field = forwardRef<
  TextInput,
  TextInputProps & { label: string; hint?: string; error?: string }
>(function Field({ label, hint, error, ...props }, ref) {
  const palette = usePalette();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ fontSize: 14, fontWeight: "600", color: palette.foreground }}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={palette.muted}
        {...props}
        style={[
          {
            minHeight: MIN_TOUCH_TARGET,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: error ? palette.danger : palette.hairlineStrong,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            fontSize: 16,
            color: palette.foreground,
            backgroundColor: palette.surface,
          },
          props.multiline ? { minHeight: 96, textAlignVertical: "top" } : null,
        ]}
      />
      {hint && !error ? <Text style={{ fontSize: 12, color: palette.muted }}>{hint}</Text> : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 12, color: palette.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});

/** The four states every screen owes the person looking at it. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  const palette = usePalette();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md }}>
      <ActivityIndicator color={palette.royal} />
      <Text style={{ color: palette.muted, fontSize: 14 }}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const palette = usePalette();
  return (
    <Card>
      <Text accessibilityRole="alert" style={{ fontWeight: "600", color: palette.foreground }}>
        Something went wrong
      </Text>
      <Body muted>{message}</Body>
      {onRetry ? (
        <Button variant="secondary" onPress={onRetry}>
          Try again
        </Button>
      ) : null}
    </Card>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <Card>
      <Text style={{ fontWeight: "600" }}>{title}</Text>
      <Body muted>{message}</Body>
      {action}
    </Card>
  );
}

export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const palette = usePalette();
  const background =
    tone === "success"
      ? "rgba(27,122,75,0.12)"
      : tone === "warning"
        ? "rgba(138,97,0,0.14)"
        : tone === "danger"
          ? "rgba(179,38,30,0.12)"
          : palette.hairline;
  const color =
    tone === "success"
      ? palette.success
      : tone === "warning"
        ? palette.warning
        : tone === "danger"
          ? palette.danger
          : palette.mutedStrong;

  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: background,
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 3,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "600", color }}>{label}</Text>
    </View>
  );
}

export function Divider() {
  const palette = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.hairline }} />;
}
