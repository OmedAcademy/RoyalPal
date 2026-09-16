import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { roleToDashboardPath } from "@/lib/utils/auth";
import type { Database, Profile, UserRole } from "@/types/database";

/**
 * Authenticated-AND-active check for Server Actions.
 *
 * Middleware and requireProfile() gate *navigation*, but Server Actions are
 * independently addressable HTTP endpoints: Next.js resolves them by action
 * id from a global manifest, not by the URL they were posted to. An action
 * invoked from an unprotected route (e.g. "/") therefore never passes
 * through the middleware's role/status checks.
 *
 * Every mutating action previously only asserted `user != null`, so a
 * suspended account kept full write access — suspension stopped browsing but
 * not booking, reviewing, or uploading. This is the single place that check
 * now lives.
 */
export async function activeUserOrError(
  supabase: SupabaseClient<Database>,
): Promise<{ user: { id: string } } | { error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return { error: "You must be signed in" };
  if (profile.status === "suspended") {
    return { error: "Your account is suspended. Please contact support." };
  }

  return { user: { id: user.id } };
}

/**
 * Server Component-side guard, layered on top of middleware's route
 * gating as defense in depth. Redirects to /login if unauthenticated, or
 * to the caller's own dashboard if their role isn't in allowedRoles
 * (admin is always allowed through, matching the RLS is_admin() bypass).
 */
export async function requireProfile(allowedRoles: UserRole[]): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  if (!profile) {
    redirect("/login");
  }

  // A suspended account keeps its session but loses all access. Checked here
  // (not only in middleware) so every server-rendered page is covered even if
  // a route is ever added outside the middleware matcher.
  if (profile.status === "suspended") {
    redirect("/suspended");
  }

  if (!allowedRoles.includes(profile.role) && profile.role !== "admin") {
    redirect(roleToDashboardPath(profile.role));
  }

  return profile;
}
