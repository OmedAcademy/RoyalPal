import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { roleToDashboardPath } from "@/lib/utils/auth";
import { safeRedirectPath } from "@/lib/utils/safe-redirect";

/**
 * Handles the redirect from every Supabase Auth email link — confirmation and
 * password recovery both land here. Exchanges the one-time code for a
 * session, then routes onward.
 *
 * `?next=` exists for recovery: the emailed link has to come back through this
 * exchange to establish a session, and only then can the user set a new
 * password, so the destination cannot be baked into the callback. It is run
 * through safeRedirectPath because the parameter is part of a URL that was
 * emailed — an attacker who can get a victim to click a link can put anything
 * in it, and an unvalidated `next` turns our own auth callback into an open
 * redirect that arrives pre-trusted.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=confirmation_failed`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", data.user.id)
    .single();

  if (!profile) {
    return NextResponse.redirect(`${origin}/login?error=missing_profile`);
  }

  // A suspended account that clicks a valid link still has a valid session;
  // the destination is the only thing that changes.
  if (profile.status === "suspended") {
    return NextResponse.redirect(`${origin}/suspended`);
  }

  const destination = safeRedirectPath(next, roleToDashboardPath(profile.role));
  return NextResponse.redirect(`${origin}${destination}`);
}
