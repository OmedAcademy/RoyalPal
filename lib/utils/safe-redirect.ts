/**
 * Validates a caller-supplied return path before it is used in a redirect.
 *
 * Every value this guards arrives from a query string — `?redirectTo=` set by
 * the middleware, `?next=` on the auth callback — which means it arrives from
 * whoever wrote the link, not from us. An unvalidated value there is an open
 * redirect: `/login?redirectTo=https://roya1pal.example/login` renders on our
 * domain, under our TLS, and hands the victim to a copy of our sign-in page
 * after they have already decided to trust the URL.
 *
 * The rules, and the attack each one closes:
 *   - must start with a single "/"          — absolute URLs to another host
 *   - must not start with "//" or "/\"      — protocol-relative URLs, which
 *                                             browsers resolve as a HOST
 *   - must not contain a backslash          — some parsers normalise "\" to
 *                                             "/", so "/\evil.com" is a host
 *                                             to them and a path to us
 *   - must not contain a control character  — "/\n\rLocation: ..." header
 *                                             splitting in any layer that
 *                                             does not re-encode
 *
 * This is an allowlist by shape rather than a denylist of bad strings: the
 * only thing that gets through is a same-origin absolute path.
 */
export function safeRedirectPath(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (value.length > 512) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
