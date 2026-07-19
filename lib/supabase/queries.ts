import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { roleToDashboardPath } from "@/lib/utils/auth";
import type { Profile, UserRole } from "@/types/database";

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

  if (!allowedRoles.includes(profile.role) && profile.role !== "admin") {
    redirect(roleToDashboardPath(profile.role));
  }

  return profile;
}
