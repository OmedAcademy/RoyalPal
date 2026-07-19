import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { roleToDashboardPath } from "@/lib/utils/auth";

const PROTECTED_PREFIXES = {
  student: "/student",
  tutor: "/tutor",
  admin: "/admin",
} as const;

/**
 * Refreshes the Supabase session cookie on every request (required since
 * Server Components can't write cookies themselves) and gates role-scoped
 * route prefixes. This is defense-in-depth's first layer; each protected
 * page also re-checks server-side in case middleware is ever bypassed or
 * misconfigured.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run any code between createServerClient and
  // getUser() — it revalidates the session token and must run on every
  // request for refresh to work correctly.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const matchedPrefix = (
    Object.keys(PROTECTED_PREFIXES) as (keyof typeof PROTECTED_PREFIXES)[]
  ).find((role) => path.startsWith(PROTECTED_PREFIXES[role]));

  if (matchedPrefix) {
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirectTo", path);
      return NextResponse.redirect(loginUrl);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (profile.role !== matchedPrefix && profile.role !== "admin") {
      return NextResponse.redirect(new URL(roleToDashboardPath(profile.role), request.url));
    }
  }

  return response;
}
