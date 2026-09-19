import { View, Text, Linking, Alert } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth";
import { Screen, Heading, Body, Card, Button, Divider, usePalette } from "@/components/ui";
import { spacing } from "@/lib/theme";

const WEB = process.env.EXPO_PUBLIC_API_URL ?? "";

/**
 * Profile and settings, shared by both roles.
 *
 * Profile EDITING opens the web app rather than being reimplemented here. That
 * is a deliberate scope decision, not an oversight: the tutor profile form has
 * fourteen fields with interdependent validation, and a second copy of it is a
 * second copy of those rules. It is called out in docs/MOBILE.md as the known
 * gap rather than hidden behind a button that looks native and is not.
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

  const profilePath = me?.profile.role === "tutor" ? "/tutor/profile" : "/student/profile";

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
        <Button variant="secondary" onPress={() => Linking.openURL(`${WEB}${profilePath}`)}>
          Edit profile on the web
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
          Account and deletion
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
