import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/observability/logger";
import type { Profile, UserRole } from "@/types/database";

const log = logger.child({ component: "api" });

/**
 * The JSON API the mobile apps talk to.
 *
 * DESIGN NOTE, AND THE ONE THING THAT MATTERS MOST HERE
 * These handlers deliberately contain NO business logic. Every write delegates
 * to the same Server Action the web app posts to, and every read delegates to
 * the same query module a page renders from. Price derivation, slot
 * validation, the cancellation policy, the notification fan-out and every
 * authorization rule live in exactly one place and are reached by two
 * transports.
 *
 * That is not tidiness. A second implementation of "what refund is owed" or
 * "is this slot free" is a second implementation that will, eventually,
 * disagree with the first — and the way you find out is a student on a phone
 * getting a refund a student on a laptop would not.
 *
 * Authentication is the bearer token, handled inside createClient(), so RLS
 * applies to a mobile request exactly as it does to a browser one.
 */

export type ApiError = { error: string; code?: string };

export function apiError(message: string, status: number, code?: string): NextResponse<ApiError> {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
}

export function apiOk<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

/**
 * Resolves the caller, or returns the response to send instead.
 *
 * Mirrors requireProfile's rules rather than inventing new ones: a suspended
 * account is refused everywhere except where the caller explicitly allows it,
 * and a role mismatch is a 403 rather than a redirect, because an API client
 * has nowhere to be redirected to.
 */
export async function requireApiUser(options?: {
  roles?: UserRole[];
  allowSuspended?: boolean;
}): Promise<{ profile: Profile } | { response: NextResponse<ApiError> }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { response: apiError("Sign in to continue", 401, "unauthenticated") };
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  if (!profile) {
    return { response: apiError("No profile on record", 403, "no_profile") };
  }

  if (profile.status === "suspended" && !options?.allowSuspended) {
    return { response: apiError("Your account is suspended", 403, "suspended") };
  }

  if (options?.roles && !options.roles.includes(profile.role) && profile.role !== "admin") {
    return { response: apiError("Not available for this account", 403, "wrong_role") };
  }

  return { profile };
}

/**
 * Runs a handler, turning anything unexpected into a 500 that carries no
 * internals. A stack trace in a mobile client's console is a stack trace in
 * every user's hands.
 */
export async function handle<T>(
  name: string,
  fn: () => Promise<NextResponse<T | ApiError>>,
): Promise<NextResponse<T | ApiError>> {
  try {
    return await fn();
  } catch (err) {
    log.error("unhandled API error", err, { route: name });
    return apiError("Something went wrong. Please try again.", 500, "internal");
  }
}

/**
 * Invokes a Server Action from a route handler.
 *
 * Actions take FormData because that is what a <form> posts; JSON in, FormData
 * across, is the whole adapter. Values are stringified because FormData has no
 * other representation — the action's own zod schema does the coercion, which
 * is the same coercion the web form gets.
 *
 * `redirect()` inside an action throws NEXT_REDIRECT rather than returning, so
 * the target is caught and handed back as a URL for the app to open. That is
 * how createBooking's checkout hand-off reaches a phone.
 */
export type ActionValue = string | number | boolean | null | undefined | (string | number)[];

export async function invokeAction<S extends { error?: string; message?: string }>(
  action: (prev: S, formData: FormData) => Promise<S>,
  values: Record<string, ActionValue>,
  initial: S,
): Promise<{ state: S } | { redirectTo: string }> {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;

    // An array APPENDS under one key, which is what formData.getAll() reads
    // and what a multi-select or a repeating row group posts. Setting a joined
    // string instead would arrive as one value containing commas — the
    // difference between "English, Spanish" as two languages and as the name
    // of one.
    if (Array.isArray(value)) {
      // An empty array appends nothing, which is what the receiving schemas
      // want: every list-replacement action parses a missing field and an
      // empty list to the same [], and both correctly mean "replace what is
      // stored with nothing". An earlier draft marked the empty case with a
      // sentinel field; nothing ever read it.
      for (const item of value) formData.append(key, String(item));
      continue;
    }

    formData.set(key, String(value));
  }

  try {
    return { state: await action(initial, formData) };
  } catch (err) {
    const url = (err as { url?: string; digest?: string }).url;
    if (url) return { redirectTo: url };

    // Next encodes the destination in `digest` as "NEXT_REDIRECT;<type>;<url>;..."
    const digest = (err as { digest?: string }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      const parts = digest.split(";");
      if (parts[2]) return { redirectTo: parts[2] };
    }
    throw err;
  }
}

/** Turns an action's state into the right HTTP answer. */
export function actionResponse(state: { error?: string; message?: string }): NextResponse {
  if (state.error) {
    // 422: the request was understood and refused on its merits (a slot taken,
    // a policy rule, a validation failure). Authentication and authorization
    // have their own codes above and never reach here.
    return apiError(state.error, 422, "rejected");
  }
  return apiOk({ ok: true, message: state.message ?? null });
}
