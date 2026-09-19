import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { Screen, Heading, Body, Field, Button, Card, usePalette } from "@/components/ui";
import { spacing } from "@/lib/theme";

export default function ForgotPasswordScreen() {
  const palette = usePalette();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit() {
    setBusy(true);
    try {
      await api.post("/api/v1/auth/reset-password", { email: email.trim() });
    } catch {
      // Swallowed on purpose. The endpoint answers identically whether or not
      // the address has an account, and a network error here must not become
      // the one signal that distinguishes them.
    }
    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <Screen contentStyle={{ justifyContent: "center", gap: spacing.lg }}>
        <Heading>Check your email</Heading>
        <Body muted>
          If that address has a RoyalPal account, we&apos;ve sent a link to reset the password. The
          link opens in your browser — come back here to sign in once you&apos;ve set a new one.
        </Body>
        <Button onPress={() => router.replace("/(auth)/sign-in")}>Back to sign in</Button>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ justifyContent: "center", gap: spacing.lg }}>
      <Heading>Reset your password</Heading>
      <Body muted>
        Enter the email you signed up with and we&apos;ll send you a link to set a new password.
      </Body>

      <Card>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@example.com"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />
        <Button onPress={onSubmit} busy={busy} disabled={!email}>
          {busy ? "Sending…" : "Send reset link"}
        </Button>
      </Card>

      <Text
        onPress={() => router.back()}
        style={{ color: palette.muted, textAlign: "center", fontSize: 14 }}
      >
        Back to sign in
      </Text>
    </Screen>
  );
}
