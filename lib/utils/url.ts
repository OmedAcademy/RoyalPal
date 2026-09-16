/**
 * URL scheme safety.
 *
 * `z.string().url()` only checks that `new URL(value)` parses — and
 * `new URL("javascript:alert(1)")` parses fine. A tutor could therefore save
 * `javascript:…` as their intro-video link, which the public tutor page
 * rendered straight into `href`, executing attacker JavaScript in this
 * origin for any student who clicked it (stored XSS). `target="_blank"` and
 * `rel="noreferrer"` do not mitigate `javascript:` — it runs in the current
 * document regardless.
 *
 * Used at BOTH boundaries on purpose:
 *   • validation, so no new hostile value can be stored, and
 *   • render, because rows written before this fix are still in the database
 *     and must not be trusted.
 *
 * Regression coverage: tests/videourl.test.ts
 */

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

/** True only for well-formed absolute http(s) URLs. */
export function isSafeHttpUrl(value: string): boolean {
  try {
    // `protocol` is normalized to lowercase by the URL parser, so mixed-case
    // schemes ("JaVaScRiPt:") cannot slip past this comparison.
    return SAFE_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Returns the URL if it is safe to place in an href, otherwise null. */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  return isSafeHttpUrl(value) ? value : null;
}
