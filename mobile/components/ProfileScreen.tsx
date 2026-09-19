import { View, Text, Linking, Alert } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth";
import { Screen, Heading, Body, Card, Button, Divider, usePalette } from "@/components/ui";
import { spacing } from "@/lib/theme";

const WEB = process.env.EXPO_PUBLIC_API_URL ?? "";

/**
 * Profile and settings, shared by both roles.
 *
 * Profile editing is native (app/profile/edit.tsx) and posts to
 * PUT /api/v1/profile, which runs the same Server Action the web form posts
 * to — so there is one copy of the validation rules, on the server.
 *
 * Two things still open the web: the avatar, which needs an image picker and a
 * direct-to-storage upload, and account deletion, which is deliberately not a
 * two-tap action on a phone. Both say so on the button.
 */
export function ProfileScreen() {
  const palette = usePalette();
  const { me, signOut } = useAuth();

  function confirmSignOut() {
    Alert.alert("Sign out?", "You'll need to sign in again to see your lessons.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  }

  return (
    <Screen>
      <Heading>Profile</Heading>

      <Card>
        <Text style={{ fontSize: 18, fontWeight: "600", color: palette.foreground }}>
          {me?.profile.fullName ?? "—"}
        </Text>
        <Body muted>
          {me?.profile.role === "tutor" ? "Tutor" : "Student"} · {me?.profile.timezone ?? "UTC"}
        </Body>
        <Button variant="secondary" onPress={() => router.push("/profile/edit")}>
          Edit profile
        </Button>
        <Button
          variant="secondary"
          onPress={() =>
            Linking.openURL(
              `${WEB}${me?.profile.role === "tutor" ? "/tutor/profile" : "/student/profile"}`,
            )
          }
        >
          Change photo on the web
        </Button>
      </Card>

      <Card>
        <Text style={{ fontWeight: "600" }}>Settings</Text>
        <Button variant="secondary" onPress={() => router.push("/notifications")}>
          Notifications
        </Button>
        <Divider />
        <Button variant="secondary" onPress={() => router.push("/support")}>
          Help and support
        </Button>
        <Divider />
        <Button variant="secondary" onPress={() => Linking.openURL(`${WEB}/settings/account`)}>
          Account and deletion (web)
        </Button>
      </Card>

      <Card>
        <Text style={{ fontWeight: "600" }}>Policies</Text>
        <View style={{ gap: spacing.sm }}>
          {[
            ["Terms", "/legal/terms"],
            ["Privacy", "/legal/privacy"],
            ["Acceptable use", "/legal/acceptable-use"],
            ["Cancellation & refunds", "/legal/cancellation"],
            ["Safeguarding", "/legal/safeguarding"],
          ].map(([label, path]) => (
            <Text
              key={path}
              accessibilityRole="link"
              onPress={() => Linking.openURL(`${WEB}${path}`)}
              style={{ color: palette.royal, fontSize: 15, paddingVertical: 6 }}
            >
              {label}
            </Text>
          ))}
        </View>
      </Card>

      <Button variant="danger" onPress={confirmSignOut}>
        Sign out
      </Button>
    </Screen>
  );
}
