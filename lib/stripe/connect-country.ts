import { countryByCode, countryByName } from "@/lib/i18n/search";

/**
 * Translates RoyalPal's country model into the ISO 3166-1 alpha-2 code
 * Stripe requires when creating a connected account.
 *
 * This exists because `profiles.country` stores a DISPLAY NAME ("Ireland",
 * "United Kingdom") — that is what the profile form's select submits — while
 * `stripe.accounts.create()` accepts only a two-letter code. Handing the name
 * straight through gets rejected by Stripe, and the rejection surfaces as a
 * generic "Could not start onboarding", which tells nobody anything.
 *
 * The mapping rule, and why it is not simply "use the sovereign state":
 *
 *   • Most entries carry a real alpha-2 and are used as-is.
 *   • A few are non-sovereign but STILL have their own ISO code and their
 *     own Stripe support — Hong Kong (`HK`, an SAR of China) being the
 *     obvious one. Collapsing those to their sovereign would put a Hong Kong
 *     tutor on a `CN` account, which is wrong.
 *   • Exactly two entries have a non-ISO code because they are subdivisions
 *     rather than countries: Kurdistan Region (`IQ-KR`) and Northern Cyprus
 *     (`CY-NC`). Stripe has no concept of either, so these fall back to the
 *     sovereign state that issues their passports — Kurdistan Region → `IQ`,
 *     per an explicit product decision.
 *
 * So the test is the SHAPE of the code, not the sovereignty type. That keeps
 * the rule correct as the dataset grows: any future entry with a real ISO
 * code works automatically, and any future subdivision falls back correctly.
 */

/** ISO 3166-1 alpha-2: exactly two uppercase letters. */
const ISO_ALPHA2 = /^[A-Z]{2}$/;

export type StripeCountryResult =
  { ok: true; code: string } | { ok: false; reason: "unknown_country" | "no_sovereign_fallback" };

export function stripeCountryFor(countryName: string | null | undefined): StripeCountryResult {
  const raw = countryName?.trim();
  if (!raw) return { ok: false, reason: "unknown_country" };

  // Accepts BOTH a display name ("Ireland") and an alpha-2 code ("IE").
  // Live rows currently hold names, seed/test fixtures hold codes, and the
  // column may migrate to codes later — resolving either means none of that
  // breaks this, and a half-migrated table keeps working throughout.
  const country =
    (raw.length === 2 ? countryByCode(raw) : undefined) ?? countryByName(raw) ?? countryByCode(raw);

  if (!country) return { ok: false, reason: "unknown_country" };

  if (ISO_ALPHA2.test(country.alpha2)) {
    return { ok: true, code: country.alpha2 };
  }

  // A subdivision (IQ-KR, CY-NC). Stripe cannot open an account for one, so
  // use the sovereign state it belongs to.
  const sovereign = country.sovereignAlpha2;
  if (sovereign && ISO_ALPHA2.test(sovereign)) {
    return { ok: true, code: sovereign };
  }

  return { ok: false, reason: "no_sovereign_fallback" };
}
