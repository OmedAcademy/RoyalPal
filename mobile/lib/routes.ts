/**
 * Translates a web href into a route this app actually has.
 *
 * Notifications are written once, on the server, for one destination: the web
 * app. The mobile router does not share those paths, so pushing a stored href
 * straight into `router.push` produced one of two failures.
 *
 * The quiet one: `/student/bookings` matches nothing and expo-router shows its
 * "Unmatched Route" developer screen — in a shipped build, to a real person.
 *
 * The loud one: `/tutor/profile` and `/tutor/payouts` DO match, against the
 * dynamic `tutor/[id]` route, with id="profile". The screen then asks the API
 * for tutor "profile", Postgres refuses to cast that to uuid, and the person
 * gets a 500 on a screen that looked plausible on the way in. A route that
 * fails is worse than one that does not exist.
 *
 * Kept as data rather than as branching inside the notifications screen so
 * every caller that navigates from a server-supplied href gets the same
 * answer, and so it is testable without a renderer.
 *
 * `null` means "this app has no such destination" — an admin link, or a path
 * added to the web since. The caller must not navigate rather than guess,
 * because guessing is what produced both failures above.
 */

export type ViewerRole = "student" | "tutor" | "admin";

/** Exact web paths, and what they are called here. */
const EXACT: Record<string, string | ((role: ViewerRole) => string)> = {
  "/student/dashboard": "/(student)",
  "/tutor/dashboard": "/(tutor)",
  "/student/bookings": "/(student)/lessons",
  "/tutor/bookings": "/(tutor)/lessons",
  "/student/tutors": "/(student)/search",
  "/student/favorites": "/saved",
  "/student/profile": "/(student)/profile",
  "/tutor/profile": "/(tutor)/profile",
  "/tutor/availability": "/availability/edit",
  // No dedicated screen for either. The tutor's own profile tab is the
  // nearest true thing; sending them to a route that 500s is not.
  "/tutor/reviews": "/(tutor)/profile",
  "/tutor/payouts": "/(tutor)/profile",
  "/notifications": "/notifications",
  "/support": "/support",
  "/messages": (role) => (role === "tutor" ? "/(tutor)/messages" : "/(student)/messages"),
};

/** Web path prefixes whose trailing id the app uses unchanged. */
const PASSTHROUGH_PREFIXES = ["/messages/", "/support/", "/tutor/"];

/** Anything under these belongs to a surface this app does not have. */
const UNSUPPORTED_PREFIXES = ["/admin", "/legal", "/blog"];

/** Everything under /settings is one screen here. */
const SETTINGS_PREFIX = "/settings";

export function toMobileRoute(href: string | null | undefined, role: ViewerRole): string | null {
  if (!href) return null;
  // Only in-app paths. An absolute URL is the web's business, and handing one
  // to the router silently does nothing.
  if (!href.startsWith("/")) return null;

  // Query strings and fragments are the web's, not this router's.
  const path = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";

  if (path === "/") return null;

  const exact = EXACT[path];
  if (exact) return typeof exact === "function" ? exact(role) : exact;

  if (path === SETTINGS_PREFIX || path.startsWith(`${SETTINGS_PREFIX}/`)) return "/profile/edit";

  if (UNSUPPORTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;

  for (const prefix of PASSTHROUGH_PREFIXES) {
    if (path.startsWith(prefix) && path.length > prefix.length) {
      // `/tutor/profile` never reaches here — EXACT catches it above — which
      // is the whole point of ordering the exact table first.
      return path;
    }
  }

  return null;
}
