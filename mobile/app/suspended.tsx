import { router } from "expo-router";
import { Screen, Heading, Body, Card, Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { spacing } from "@/lib/theme";

export default function SuspendedScreen() {
  const { signOut } = useAuth();

  return (
    <Screen contentStyle={{ justifyContent: "center", gap: spacing.lg }}>
      <Card>
        <Heading>Account suspended</Heading>
        <Body muted>
          Your RoyalPal account is suspended, so lessons, bookings and messages are paused. If you
          think this is a mistake, open a support request — support stays available to a suspended
          account so you can appeal.
        </Body>
        <Button onPress={() => router.push("/support")}>Contact support</Button>
        <Button variant="secondary" onPress={() => void signOut()}>
          Sign out
        </Button>
      </Card>
    </Screen>
  );
}
