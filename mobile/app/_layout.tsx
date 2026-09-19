import { useEffect } from "react";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { View, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider, useAuth } from "@/lib/auth";
import { installNotificationHandler } from "@/lib/push";
import { usePalette, Loading } from "@/components/ui";
import { spacing } from "@/lib/theme";

// Held until the session has been read from the keychain, so the app never
// flashes the sign-in screen at someone who is already signed in.
void SplashScreen.preventAutoHideAsync();

installNotificationHandler();

/**
 * Routes the person to the right place for who they are.
 *
 * Kept in one effect rather than scattered across screens: an auth redirect
 * implemented per screen is how you end up with a loop between two screens
 * that each think the other should handle it.
 */
function AuthGate() {
  const { session, me, loading, configured } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    void SplashScreen.hideAsync();

    const group = segments[0];
    const inAuthGroup = group === "(auth)";
    const inPublic = group === "legal";

    if (!session) {
      if (!inAuthGroup && !inPublic) router.replace("/(auth)/sign-in");
      return;
    }

    // Signed in but the profile has not loaded yet — wait rather than guess a
    // destination and bounce them a second time once it arrives.
    if (!me) return;

    if (me.profile.status === "suspended") {
      if (group !== "suspended" && group !== "support" && !inPublic) {
        router.replace("/suspended");
      }
      return;
    }

    if (inAuthGroup) {
      router.replace(me.profile.role === "tutor" ? "/(tutor)" : "/(student)");
    }
  }, [session, me, loading, segments]);

  if (!configured) {
    return <ConfigurationNotice />;
  }

  if (loading) return <Loading label="Signing you in…" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(student)" />
      <Stack.Screen name="(tutor)" />
      <Stack.Screen name="tutor/[id]" options={{ headerShown: true, title: "Tutor" }} />
      <Stack.Screen name="book/[id]" options={{ headerShown: true, title: "Book a lesson" }} />
      <Stack.Screen name="messages/[id]" options={{ headerShown: true, title: "Conversation" }} />
      <Stack.Screen name="notifications" options={{ headerShown: true, title: "Notifications" }} />
      <Stack.Screen name="suspended" options={{ headerShown: false }} />
    </Stack>
  );
}

/**
 * Shown when the build has no Supabase configuration. A blank screen or a
 * crash inside the auth library would send whoever hits this hunting in the
 * wrong place.
 */
function ConfigurationNotice() {
  const palette = usePalette();
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: spacing.xl,
        gap: spacing.md,
        backgroundColor: palette.background,
      }}
    >
      <Text style={{ fontSize: 18, fontWeight: "600", color: palette.foreground }}>
        RoyalPal isn&apos;t configured
      </Text>
      <Text style={{ textAlign: "center", color: palette.muted }}>
        This build has no EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy
        .env.example to .env and fill them in, then restart the bundler.
      </Text>
    </View>
  );
}

/**
 * Notification taps. The server puts an app path in `data.href`, so a
 * notification about a message opens that conversation rather than the home
 * screen — the difference between a notification that is useful and one people
 * swipe away.
 */
function useNotificationRouting() {
  useEffect(() => {
    // Covers a cold start FROM a notification, which the listener below misses
    // because it fires before any listener is attached.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const href = response?.notification.request.content.data?.href;
      if (typeof href === "string" && href.startsWith("/")) router.push(href);
    });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const href = response.notification.request.content.data?.href;
      if (typeof href === "string" && href.startsWith("/")) router.push(href);
    });

    return () => subscription.remove();
  }, []);
}

function Root() {
  useNotificationRouting();
  return <AuthGate />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="auto" />
          <Root />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
