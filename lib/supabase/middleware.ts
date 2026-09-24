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
 * Routes any SIGNED-IN role may use. They exist because messaging, settings
 * and support are the same product for a student and a tutor, and giving each
 * role its own copy would mean two of everything — two routes, two layouts,
 * two sets of bugs — for one feature.
 *
 * They still need listing here: middleware gates by path prefix, so a route
 * outside both maps would be reachable while signed out. Suspension is
 * enforced for these exactly as it is for the role-scoped ones.
 */
const AUTHENTICATED_PREFIXES = ["/messages", "/settings", "/support"] as const;

/** True when this path must not render for an anonymous visitor. */
export function pathRequiresSession(pathname: string): boolean {
  const matchedPrefix = (
    Object.keys(PROTECTED_PREFIXES) as (keyof typeof PROTECTED_PREFIXES)[]
  ).some((role) => pathname.startsWith(PROTECTED_PREFIXES[role]));
  const needsAnyRole = AUTHENTICATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return matchedPrefix || needsAnyRole;
}

/**
 * The one authenticated area a SUSPENDED account may still reach.
 *
 * Suspension cuts off everything else, and should — but appealing the
 * suspension is the single thing a suspended person legitimately needs to do,
 * and every other route in the product tells them to "contact support". A
 * suspension that also blocks the appeal route is a dead end with our own
 * error message pointing into it.
 */
const SUSPENDED_ALLOWED_PREFIXES = ["/support"] as const;

/**
 * Refreshes the Supabase session cookie on every request (required since
 * Server Components can't write cookies themselves) and gates role-scoped
 * route prefixes. This is defense-in-depth's first layer; each protected
 * page also re-checks server-side in case middleware is ever bypassed or
 * misconfigured.
 *
 * A deployment with no public Supabase env (or a client that throws) must
 * not take down the marketing site. Protected paths fail closed — they
 * bounce to sign-in — and everything else renders.
 */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !anonKey) {
    return responseWhenAuthUnavailable(request, path);
  }

  try {
    return await refreshAndGate(request, supabaseUrl, anonKey);
  } catch (err) {
    console.error(
      "[middleware] session refresh failed",
      err instanceof Error ? err.name : "unknown",
    );
    return responseWhenAuthUnavailable(request, path);
  }
}

function responseWhenAuthUnavailable(request: NextRequest, path: string) {
  if (!pathRequiresSession(path)) {
    return NextResponse.next({ request });
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirectTo", path);
  return NextResponse.redirect(loginUrl);
}

async function refreshAndGate(request: NextRequest, supabaseUrl: string, anonKey: string) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseUrl, anonKey, {
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
  });

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
  const needsAnyRole = AUTHENTICATED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

  if (matchedPrefix || needsAnyRole) {
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirectTo", path);
      return NextResponse.redirect(loginUrl);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // Suspended accounts are cut off at the edge, before any page renders —
    // except on the appeal route above.
    const appealRoute = SUSPENDED_ALLOWED_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
    if (profile.status === "suspended" && !appealRoute) {
      return NextResponse.redirect(new URL("/suspended", request.url));
    }

    // Role scoping applies only to the role-prefixed areas; the shared ones
    // are open to every active, signed-in account.
    if (matchedPrefix && profile.role !== matchedPrefix && profile.role !== "admin") {
      return NextResponse.redirect(new URL(roleToDashboardPath(profile.role), request.url));
    }
  }

  return response;
}
