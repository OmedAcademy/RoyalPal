import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Infra connectivity check only — confirms the running app can reach
 * Supabase with the configured env vars. Not part of the product surface;
 * safe to keep as a permanent ops health check or remove once M2+ gives us
 * a real page to smoke-test against.
 */
export async function GET() {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("subjects")
    .select("*", { count: "exact", head: true });

  if (error) {
    // Full detail server-side only — this endpoint has no auth, so the
    // HTTP response itself must not leak Postgres internals to callers.
    console.error("health check supabase error:", JSON.stringify(error, null, 2));
    return NextResponse.json({ ok: false, error: "database connection failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, subjectCount: count });
}
