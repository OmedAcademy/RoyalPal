import { useState } from "react";
import { View, Text, KeyboardAvoidingView, Platform } from "react-native";
import { Link } from "expo-router";
import { supabase } from "@/lib/supabase";
import { Screen, Heading, Body, Field, Button, Card, usePalette } from "@/components/ui";
import { spacing, typography } from "@/lib/theme";

export default function SignInScreen() {
  const palette = usePalette();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    // The redirect is handled centrally by AuthGate reacting to the session
    // change, so there is nothing to navigate to here.
    if (signInError) setError(signInError.message);
    setBusy(false);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <Screen contentStyle={{ justifyContent: "center", gap: spacing.xl }}>
        <View style={{ gap: spacing.xs }}>
          <Text style={{ fontFamily: typography.display, fontSize: 30, color: palette.foreground }}>
            Royal<Text style={{ color: palette.royal }}>Pal</Text>
          </Text>
          <Heading>Welcome back</Heading>
          <Body muted>Sign in to see your lessons.</Body>
        </View>

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
            returnKeyType="next"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            placeholder="••••••••"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />

          {error ? (
            <Text accessibilityRole="alert" style={{ color: palette.danger, fontSize: 14 }}>
              {error}
            </Text>
          ) : null}

          <Button onPress={onSubmit} busy={busy} disabled={!email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>

          <Link href="/(auth)/forgot-password" style={{ alignSelf: "center" }}>
            <Text style={{ color: palette.muted, fontSize: 14 }}>Forgot your password?</Text>
          </Link>
        </Card>

        <Link href="/(auth)/sign-up" style={{ alignSelf: "center" }}>
          <Text style={{ color: palette.royal, fontSize: 15, fontWeight: "600" }}>
            New to RoyalPal? Create an account
          </Text>
        </Link>
      </Screen>
    </KeyboardAvoidingView>
  );
}
