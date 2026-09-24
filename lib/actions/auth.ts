"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  loginSchema,
  signupSchema,
  requestPasswordResetSchema,
  updatePasswordSchema,
} from "@/lib/validations/auth";
import { roleToDashboardPath } from "@/lib/utils/auth";
import { safeRedirectPath } from "@/lib/utils/safe-redirect";
import { LEGAL_VERSION } from "@/lib/constants/legal";
import { consumeRateLimit, rateLimitMessage } from "@/lib/rate-limit/limiter";
import { logger } from "@/lib/observability/logger";
import type { UserRole } from "@/types/database";

const log = logger.child({ component: "auth-action" });

/**
 * GoTrue writes its own messages for the person filling in the form
 * ("Invalid login credentials", "Password should be at least…"). A database
 * trigger that fails the same call does not — its text is a Postgres error,
 * and that must not land under the form.
 */
function authErrorForUser(message: string, fallback: string): string {
  if (
    /violat|syntax error|relation |column |sqlstate|duplicate key|postgres|permission denied|database error/i.test(
      message,
    )
  ) {
    return fallback;
  }
  return message;
}

export type AuthActionState = {
  error?: string;
  message?: string;
};

/** Origin to build the email-confirmation callback link against. */
async function currentOrigin(): Promise<string> {
  const headersList = await headers();
  const origin = headersList.get("origin");
  if (origin) return origin;

  const host = headersList.get("host");
  const isLocal = host?.startsWith("localhost") || host?.startsWith("127.0.0.1");
  if (host) return `${isLocal ? "http" : "https"}://${host}`;

  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function signup(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    dateOfBirth: formData.get("dateOfBirth"),
    role: formData.get("role"),
    acceptedTerms: formData.get("acceptedTerms"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { fullName, email, password, dateOfBirth, role } = parsed.data;

  const limit = await consumeRateLimit("signup", email);
  if (!limit.allowed) return { error: rateLimitMessage(limit) };

  const supabase = await createClient();
  const origin = await currentOrigin();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // handle_new_user (migrations 0012/0039) reads every one of these
      // INSIDE the auth.users insert, so the profile, the age check and the
      // consent record are part of the same transaction as the account.
      data: {
        role,
        full_name: fullName,
        date_of_birth: dateOfBirth,
        terms_version: LEGAL_VERSION,
      },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    // The database trigger's age refusal surfaces here as an opaque signup
    // failure; translate it rather than showing a Postgres message.
    if (/aged 18/i.test(error.message)) {
      return { error: "RoyalPal is only available to users aged 18 and over." };
    }
    return {
      error: authErrorForUser(error.message, "We couldn't create that account. Please try again."),
    };
  }

  // Email confirmation is required by the project's Auth settings: no
  // session yet, the user needs to click the link we just emailed them.
  if (!data.session) {
    return { message: "Check your email to confirm your account before signing in." };
  }

  redirect(roleToDashboardPath(role as UserRole));
}

export async function login(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const limit = await consumeRateLimit("login", parsed.data.email);
  if (!limit.allowed) return { error: rateLimitMessage(limit) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return {
      error: authErrorForUser(error.message, "We couldn't sign you in. Please try again."),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile) {
    await supabase.auth.signOut();
    return { error: "Your account has no profile on record. Contact support." };
  }

  // The middleware sets ?redirectTo= when it bounces an unauthenticated user
  // off a protected page. Until now nothing read it, so every deep link —
  // an emailed lesson link, a shared tutor profile — dumped the user on their
  // dashboard after signing in. safeRedirectPath is what makes honouring it
  // safe: the value comes from the URL, so it comes from whoever wrote the
  // link, and an unchecked one is an open redirect.
  const requested = formData.get("redirectTo");
  redirect(
    safeRedirectPath(
      typeof requested === "string" ? requested : null,
      roleToDashboardPath(profile.role),
    ),
  );
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Sends a password-reset link.
 *
 * ALWAYS reports success. Whether an address has an account is exactly the
 * fact an attacker wants, and a form that answers "no account found" is a
 * free account-enumeration oracle bolted to the signup funnel. The rate
 * limit is per address so the same non-answer cannot be used to enumerate by
 * timing or volume either.
 */
export async function requestPasswordReset(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = requestPasswordResetSchema.safeParse({ email: formData.get("email") });

  // Even a malformed address gets the same answer, for the same reason.
  const sameAnswer = {
    message: "If that address has a RoyalPal account, we've sent a link to reset the password.",
  };

  if (!parsed.success) return sameAnswer;

  const limit = await consumeRateLimit("passwordReset", parsed.data.email);
  if (!limit.allowed) return sameAnswer;

  const supabase = await createClient();
  const origin = await currentOrigin();

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  if (error) {
    // Logged, not surfaced: a delivery failure is ours to fix and telling the
    // caller about it would leak that the address exists.
    log.error("password reset email failed", error);
  }

  return sameAnswer;
}

/**
 * Sets a new password. Requires the recovery session that /auth/callback
 * established from the emailed link — there is no "reset by email address"
 * path here, because that is what the link is.
 */
export async function updatePassword(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "That reset link has expired or already been used. Request a new one to continue.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      error: authErrorForUser(error.message, "We couldn't update that password. Please try again."),
    };
  }

  // Sign every other session out. A password reset is the standard response to
  // "someone else may be in my account", and leaving that someone signed in
  // elsewhere makes the reset theatre.
  await supabase.auth.signOut({ scope: "others" });

  return { message: "Your password has been updated. You're signed in." };
}
