import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { roleToDashboardPath } from "@/lib/utils/auth";

/**
 * Handles the redirect from Supabase Auth email-confirmation links.
 * Exchanges the one-time code for a session, then routes the user to their
 * role's dashboard — same mapping used by the login action and middleware.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

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
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (!profile) {
    return NextResponse.redirect(`${origin}/login?error=missing_profile`);
  }

  return NextResponse.redirect(`${origin}${roleToDashboardPath(profile.role)}`);
}
