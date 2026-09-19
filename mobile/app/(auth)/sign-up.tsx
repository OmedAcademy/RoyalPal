import { useState } from "react";
import { View, Text, Pressable, KeyboardAvoidingView, Platform, Linking } from "react-native";
import { Link, router } from "expo-router";
import { api, ApiError } from "@/lib/api";
import { Screen, Heading, Body, Field, Button, Card, usePalette } from "@/components/ui";
import { spacing, radius, MIN_TOUCH_TARGET } from "@/lib/theme";

const WEB = process.env.EXPO_PUBLIC_API_URL ?? "";

/**
 * Sign-up posts to the RoyalPal API rather than calling supabase.auth.signUp
 * directly.
 *
 * That is the difference between the age gate being a rule and being a
 * suggestion: validation, the 18+ check, the password policy and the consent
 * record all run server-side, in the same code path the web form uses. A
 * client-side age check lives on a device its owner controls.
 */
export default function SignUpScreen() {
  const palette = usePalette();
  const [role, setRole] = useState<"student" | "tutor">("student");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/auth/sign-up", {
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        dateOfBirth: dateOfBirth.trim(),
        role,
        acceptedTerms: accepted ? "on" : "",
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create your account.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Screen contentStyle={{ justifyContent: "center", gap: spacing.lg }}>
        <Heading>Check your email</Heading>
        <Body muted>
          We&apos;ve sent a link to {email.trim()}. Open it to confirm your account, then come back
          and sign in.
        </Body>
        <Button onPress={() => router.replace("/(auth)/sign-in")}>Back to sign in</Button>
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <Screen contentStyle={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.xs }}>
          <Heading>Create your account</Heading>
          <Body muted>RoyalPal is for people aged 18 and over.</Body>
        </View>

        <Card>
          <Text style={{ fontSize: 14, fontWeight: "600", color: palette.foreground }}>
            I want to join as a…
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {(["student", "tutor"] as const).map((option) => {
              const active = role === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setRole(option)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={{
                    flex: 1,
                    minHeight: MIN_TOUCH_TARGET,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: active ? palette.royal : palette.hairlineStrong,
                    backgroundColor: active ? palette.royal : "transparent",
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "600",
                      color: active ? palette.royalContrast : palette.foreground,
                    }}
                  >
                    {option === "student" ? "Student" : "Tutor"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Field
            label="Full name"
            value={fullName}
            onChangeText={setFullName}
            autoComplete="name"
            textContentType="name"
            placeholder="Your name"
          />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            hint="At least 10 characters. Avoid anything you use on another site."
          />
          <Field
            label="Date of birth"
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            autoComplete="birthdate-full"
            hint="RoyalPal is for people aged 18 and over."
          />

          <Pressable
            onPress={() => setAccepted((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.sm,
              minHeight: MIN_TOUCH_TARGET,
              paddingVertical: spacing.sm,
            }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                borderWidth: 1.5,
                borderColor: accepted ? palette.royal : palette.hairlineStrong,
                backgroundColor: accepted ? palette.royal : "transparent",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 2,
              }}
            >
              {accepted ? <Text style={{ color: palette.royalContrast }}>✓</Text> : null}
            </View>
            <Text style={{ flex: 1, fontSize: 14, color: palette.muted, lineHeight: 20 }}>
              I&apos;m 18 or over and I agree to RoyalPal&apos;s{" "}
              <Text
                style={{ color: palette.royal }}
                onPress={() => Linking.openURL(`${WEB}/legal/terms`)}
              >
                Terms
              </Text>{" "}
              and{" "}
              <Text
                style={{ color: palette.royal }}
                onPress={() => Linking.openURL(`${WEB}/legal/privacy`)}
              >
                Privacy Policy
              </Text>
              .
            </Text>
          </Pressable>

          {error ? (
            <Text accessibilityRole="alert" style={{ color: palette.danger, fontSize: 14 }}>
              {error}
            </Text>
          ) : null}

          <Button
            onPress={onSubmit}
            busy={busy}
            disabled={!fullName || !email || !password || !dateOfBirth || !accepted}
          >
            {busy ? "Creating account…" : "Create account"}
          </Button>
        </Card>

        <Link href="/(auth)/sign-in" style={{ alignSelf: "center" }}>
          <Text style={{ color: palette.royal, fontWeight: "600" }}>
            Already have an account? Sign in
          </Text>
        </Link>
      </Screen>
    </KeyboardAvoidingView>
  );
}
