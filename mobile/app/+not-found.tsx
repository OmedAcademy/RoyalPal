import { View, Text } from "react-native";
import { Stack, router } from "expo-router";
import { Button, usePalette } from "@/components/ui";
import { spacing } from "@/lib/theme";

/**
 * The backstop for a route this build does not have.
 *
 * Without this file expo-router shows its own developer screen — "Unmatched
 * Route", with the path and a stack trace — to whoever is holding the phone.
 * lib/routes.ts is what should stop a link getting this far; this is what
 * happens when something does anyway, and it has to read as an app, not as a
 * crash.
 */
export default function NotFoundScreen() {
  const palette = usePalette();

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.md,
        padding: spacing.xl,
        backgroundColor: palette.background,
      }}
    >
      <Stack.Screen options={{ title: "Not found" }} />
      <Text style={{ fontSize: 22, fontWeight: "700", color: palette.foreground }}>
        We can&apos;t open that
      </Text>
      <Text style={{ textAlign: "center", color: palette.muted }}>
        That link points somewhere this app doesn&apos;t have. It may only exist on the RoyalPal
        website.
      </Text>
      <Button onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
        Go back
      </Button>
    </View>
  );
}
