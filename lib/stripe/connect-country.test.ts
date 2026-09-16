import { describe, it, expect } from "vitest";
import { stripeCountryFor } from "@/lib/stripe/connect-country";

/**
 * The bug this prevents: profiles.country stores a display name, and passing
 * it straight to stripe.accounts.create() gets rejected — surfacing as a
 * generic "Could not start onboarding" that explains nothing. Every case
 * below is a real row shape from the live database or the i18n dataset.
 */

describe("stripeCountryFor — display name to ISO alpha-2", () => {
  it("resolves the names actually stored on live tutor rows", () => {
    // These two are literally what is in the database today.
    expect(stripeCountryFor("Ireland")).toEqual({ ok: true, code: "IE" });
    expect(stripeCountryFor("United Kingdom")).toEqual({ ok: true, code: "GB" });
  });

  it("resolves legacy display names kept for backward compatibility", () => {
    expect(stripeCountryFor("United States")).toEqual({ ok: true, code: "US" });
    expect(stripeCountryFor("South Korea")).toEqual({ ok: true, code: "KR" });
  });

  it("is case- and whitespace-insensitive", () => {
    // countryByName normalizes; a select value should never drift, but a
    // hand-edited row might.
    expect(stripeCountryFor("ireland")).toEqual({ ok: true, code: "IE" });
    expect(stripeCountryFor("  Ireland  ")).toEqual({ ok: true, code: "IE" });
  });

  it("maps Kurdistan Region to Iraq — it is a subdivision, not a country", () => {
    // Its dataset code is "IQ-KR", which Stripe has no concept of. Product
    // decision: onboard under the sovereign state.
    expect(stripeCountryFor("Kurdistan Region")).toEqual({ ok: true, code: "IQ" });
  });

  it("refuses Northern Cyprus rather than inventing a sovereign for it", () => {
    // Also a non-ISO code ("CY-NC"), but unlike Kurdistan Region it is
    // `disputed` with NO sovereignAlpha2 in the dataset — deliberately, since
    // a TRNC resident cannot open a Cyprus Stripe account in practice.
    // Failing closed here beats guessing "CY" and being rejected by Stripe
    // later with a message nobody can act on.
    expect(stripeCountryFor("Northern Cyprus")).toEqual({
      ok: false,
      reason: "no_sovereign_fallback",
    });
  });

  it("keeps Hong Kong on HK rather than collapsing it to China", () => {
    // The regression a naive "always use the sovereign state" rule would
    // cause: Hong Kong is non-sovereign but has its own ISO code AND its own
    // Stripe support, so a HK tutor must not land on a CN account.
    expect(stripeCountryFor("Hong Kong")).toEqual({ ok: true, code: "HK" });
  });

  it("rejects an unknown country instead of guessing", () => {
    expect(stripeCountryFor("Atlantis")).toEqual({ ok: false, reason: "unknown_country" });
  });

  it("rejects null/undefined/empty without throwing", () => {
    expect(stripeCountryFor(null)).toEqual({ ok: false, reason: "unknown_country" });
    expect(stripeCountryFor(undefined)).toEqual({ ok: false, reason: "unknown_country" });
    expect(stripeCountryFor("")).toEqual({ ok: false, reason: "unknown_country" });
  });

  it("never returns anything but two uppercase letters when it succeeds", () => {
    // Stripe rejects any other shape, so this is the invariant that matters.
    for (const name of [
      "Ireland",
      "United Kingdom",
      "Kurdistan Region",
      "Hong Kong",
      "United States",
      "Japan",
      "Brazil",
    ]) {
      const result = stripeCountryFor(name);
      expect(result.ok, name).toBe(true);
      if (result.ok) expect(result.code, name).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe("stripeCountryFor — accepts codes as well as names", () => {
  it("resolves an alpha-2 code directly", () => {
    // Seed/test fixtures store codes; the column may migrate to codes later.
    // Both shapes must work, including through a half-migrated table.
    expect(stripeCountryFor("US")).toEqual({ ok: true, code: "US" });
    expect(stripeCountryFor("IE")).toEqual({ ok: true, code: "IE" });
  });

  it("is case-insensitive on codes", () => {
    expect(stripeCountryFor("ie")).toEqual({ ok: true, code: "IE" });
  });

  it("prefers the code interpretation for 2-char input", () => {
    // No real country NAME is two characters, so a 2-char value is a code.
    const result = stripeCountryFor("GB");
    expect(result).toEqual({ ok: true, code: "GB" });
  });

  it("still rejects a 2-char string that is not a country code", () => {
    expect(stripeCountryFor("ZZ")).toEqual({ ok: false, reason: "unknown_country" });
  });
});
