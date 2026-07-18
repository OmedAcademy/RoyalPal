import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Admin/service-role Supabase client. Bypasses Row Level Security entirely.
 *
 * Only ever call this from trusted server-side code with a specific reason
 * to bypass RLS: the Stripe webhook handler (M9) writing to `payments`, or
 * an admin Server Action (M15) that needs to act across all rows. Never
 * import this file from a Client Component, and never let
 * SUPABASE_SERVICE_ROLE_KEY be exposed via a NEXT_PUBLIC_* env var — the
 * `server-only` import above will throw a build error if this file is
 * accidentally pulled into client-side code.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
