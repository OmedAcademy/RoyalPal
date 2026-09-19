import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { Database } from "@/types/database";

/**
 * Supabase client for use in Server Components, Server Actions, and Route
 * Handlers. Subject to RLS as the currently signed-in user (or anon) —
 * this is NOT the admin/service-role client.
 *
 * TWO WAYS A SESSION CAN ARRIVE, AND WHY THAT MATTERS
 *
 * The web app carries its session in cookies. The mobile apps cannot: there is
 * no cookie jar shared with a native client, so they hold the Supabase session
 * themselves and send it as `Authorization: Bearer <access token>`.
 *
 * Reading both HERE, in the one place every server-side caller already goes
 * through, is what lets the iOS and Android apps reuse the existing Server
 * Actions and queries unchanged. The alternative — a parallel set of
 * mobile-only handlers that re-derive prices, re-check availability and
 * re-implement the cancellation policy — is exactly the duplicated business
 * logic that guarantees the two surfaces eventually disagree about money.
 *
 * The bearer path is no weaker than the cookie path: both produce a
 * user-scoped client that RLS applies to identically, and the token is
 * verified by Supabase, not by us. A forged token authenticates as nobody.
 */
export async function createClient() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  const authorization = headerStore.get("authorization");
  const bearer =
    authorization && authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : null;

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Only set when a bearer token is present, so the web path is untouched.
      ...(bearer ? { global: { headers: { Authorization: `Bearer ${bearer}` } } } : {}),
      cookies: {
        getAll() {
          // A bearer-authenticated request must not also pick up whatever
          // cookies happened to ride along: mixing the two lets a stale cookie
          // session silently win over the token the caller actually sent.
          return bearer ? [] : cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          if (bearer) return;
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component that can't set cookies directly;
            // safe to ignore as long as session refresh happens in middleware.
          }
        },
      },
    },
  );
}
