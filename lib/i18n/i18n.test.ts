import { describe, it, expect } from "vitest";
import { COUNTRY_DATA } from "@/lib/i18n/countries";
import { LANGUAGE_DATA } from "@/lib/i18n/languages";
import {
  normalizeSearch,
  searchCountries,
  searchLanguages,
  countryByCode,
  countryByName,
  languageByCode,
  languageDirection,
} from "@/lib/i18n/search";
import { COUNTRY_NAME_SET } from "@/lib/constants/countries";
import { LANGUAGE_NAME_SET } from "@/lib/constants/languages";

/**
 * Independent snapshot of every value the legacy lists could have stored on
 * a profile. These MUST remain valid forever — dropping one would orphan an
 * existing user's saved country/language. This array is the contract.
 */
const LEGACY_COUNTRY_NAMES = [
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "New Zealand",
  "Ireland",
  "India",
  "Pakistan",
  "Bangladesh",
  "Philippines",
  "Nigeria",
  "South Africa",
  "Egypt",
  "Morocco",
  "Kenya",
  "Ghana",
  "United Arab Emirates",
  "Saudi Arabia",
  "Qatar",
  "Kuwait",
  "Turkey",
  "Israel",
  "Germany",
  "France",
  "Spain",
  "Italy",
  "Portugal",
  "Netherlands",
  "Belgium",
  "Switzerland",
  "Austria",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Poland",
  "Ukraine",
  "Russia",
  "Greece",
  "Romania",
  "Czech Republic",
  "Hungary",
  "China",
  "Japan",
  "South Korea",
  "Taiwan",
  "Vietnam",
  "Thailand",
  "Indonesia",
  "Malaysia",
  "Singapore",
  "Brazil",
  "Mexico",
  "Argentina",
  "Chile",
  "Colombia",
  "Peru",
  "Venezuela",
  "Other",
];

const LEGACY_LANGUAGE_NAMES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Dutch",
  "Russian",
  "Ukrainian",
  "Polish",
  "Turkish",
  "Arabic",
  "Hebrew",
  "Persian (Farsi)",
  "Hindi",
  "Urdu",
  "Bengali",
  "Punjabi",
  "Chinese (Mandarin)",
  "Cantonese",
  "Japanese",
  "Korean",
  "Vietnamese",
  "Thai",
  "Indonesian",
  "Malay",
  "Tagalog",
  "Swahili",
  "Amharic",
  "Greek",
  "Romanian",
  "Czech",
  "Swedish",
  "Norwegian",
  "Danish",
  "Finnish",
];

describe("country dataset completeness", () => {
  it("includes the full ISO 3166 set plus territories and regions", () => {
    // 249 ISO 3166-1 entries + Kurdistan Region + Northern Cyprus.
    expect(COUNTRY_DATA.length).toBeGreaterThanOrEqual(250);
  });

  it("has unique alpha-2, alpha-3, and names", () => {
    const alpha2 = COUNTRY_DATA.map((c) => c.alpha2);
    const alpha3 = COUNTRY_DATA.map((c) => c.alpha3).filter(Boolean);
    const names = COUNTRY_DATA.map((c) => c.name);
    expect(new Set(alpha2).size).toBe(alpha2.length);
    expect(new Set(alpha3).size).toBe(alpha3.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every entry a non-empty flag", () => {
    for (const c of COUNTRY_DATA) expect(c.flag.length).toBeGreaterThan(0);
  });

  it("has Iraq with correct ISO codes", () => {
    const iraq = countryByCode("IQ");
    expect(iraq?.name).toBe("Iraq");
    expect(iraq?.alpha3).toBe("IRQ");
    expect(iraq?.numeric).toBe("368");
  });

  it("has Kurdistan Region as a region of Iraq, NOT a sovereign state", () => {
    const krg = countryByName("Kurdistan Region");
    expect(krg).toBeDefined();
    expect(krg?.type).toBe("region");
    expect(krg?.type).not.toBe("sovereign");
    expect(krg?.sovereignAlpha2).toBe("IQ");
  });

  it("includes territories, dependencies, SARs, observers, and disputed entities", () => {
    const byName = (n: string) => countryByName(n);
    expect(byName("Puerto Rico")?.type).toBe("territory");
    expect(byName("Hong Kong")?.type).toBe("sar");
    expect(byName("Macau")?.type).toBe("sar");
    expect(byName("Isle of Man")?.type).toBe("crown-dependency");
    expect(byName("Jersey")?.type).toBe("crown-dependency");
    expect(byName("Guernsey")?.type).toBe("crown-dependency");
    expect(byName("Greenland")?.type).toBe("dependency");
    expect(byName("Palestine")?.type).toBe("observer");
    expect(byName("Kosovo")?.type).toBe("disputed");
    expect(byName("Northern Cyprus")?.type).toBe("disputed");
    for (const n of [
      "Guam",
      "Taiwan",
      "Western Sahara",
      "Bermuda",
      "Faroe Islands",
      "Åland Islands",
    ]) {
      expect(byName(n), n).toBeDefined();
    }
  });
});

describe("language dataset completeness", () => {
  it("is comprehensive", () => {
    expect(LANGUAGE_DATA.length).toBeGreaterThanOrEqual(100);
  });

  it("has unique codes and names", () => {
    const codes = LANGUAGE_DATA.map((l) => l.code);
    const names = LANGUAGE_DATA.map((l) => l.name);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("supports Kurdish as a first-class language with every major variant", () => {
    for (const code of ["ku", "ckb", "kmr", "sdh", "zza", "hac"]) {
      expect(languageByCode(code), code).toBeDefined();
    }
    expect(languageByCode("ku")?.name).toBe("Kurdish");
    expect(languageByCode("ckb")?.name).toBe("Kurdish (Sorani)");
    expect(languageByCode("kmr")?.name).toBe("Kurdish (Kurmanji)");
    expect(languageByCode("hac")?.name).toBe("Kurdish (Hawrami / Gorani)");
    expect(languageByCode("zza")?.name).toBe("Kurdish (Zazaki)");
    expect(languageByCode("sdh")?.name).toContain("Pehlewani");
  });

  it("assigns writing direction correctly", () => {
    expect(languageDirection("Arabic")).toBe("rtl");
    expect(languageDirection("Kurdish (Sorani)")).toBe("rtl");
    expect(languageDirection("Persian (Farsi)")).toBe("rtl");
    expect(languageDirection("Kurdish (Kurmanji)")).toBe("ltr");
    expect(languageDirection("English")).toBe("ltr");
    expect(languageDirection("Definitely Not A Language")).toBe("ltr"); // safe default
  });
});

describe("search quality", () => {
  it("finds Iraq by English name and by demonym alias", () => {
    expect(searchCountries("Iraq")[0]?.name).toBe("Iraq");
    expect(searchCountries("Iraqi")[0]?.name).toBe("Iraq");
  });

  it("finds Kurdistan Region by name, short form, and KRG", () => {
    expect(searchCountries("Kurdistan")[0]?.name).toBe("Kurdistan Region");
    expect(searchCountries("KRG")[0]?.name).toBe("Kurdistan Region");
  });

  it("finds languages by alias and native spelling", () => {
    expect(searchLanguages("Sorani")[0]?.code).toBe("ckb");
    expect(searchLanguages("Kurmanji")[0]?.code).toBe("kmr");
    expect(searchLanguages("Farsi")[0]?.code).toBe("fa");
    expect(searchLanguages("Mandarin")[0]?.name).toBe("Chinese (Mandarin)");
  });

  it("is case-insensitive", () => {
    expect(searchLanguages("SORANI")[0]?.code).toBe("ckb");
    expect(searchCountries("iraq")[0]?.name).toBe("Iraq");
  });

  it("is accent-insensitive", () => {
    expect(normalizeSearch("Réunion")).toBe("reunion");
    expect(searchCountries("reunion").some((c) => c.name === "Réunion")).toBe(true);
    expect(searchCountries("cote d ivoire").some((c) => c.name === "Côte d'Ivoire")).toBe(true);
  });

  it("matches native (non-Latin) spellings", () => {
    expect(searchCountries("العراق")[0]?.name).toBe("Iraq");
  });

  it("looks up country codes case-insensitively", () => {
    expect(countryByCode("iq")?.name).toBe("Iraq");
    expect(countryByCode("irq")?.name).toBe("Iraq");
  });
});

describe("backward compatibility (nothing disappears)", () => {
  it("keeps every legacy country name valid", () => {
    for (const name of LEGACY_COUNTRY_NAMES) {
      expect(COUNTRY_NAME_SET.has(name), name).toBe(true);
    }
  });

  it("keeps every legacy language name valid", () => {
    for (const name of LEGACY_LANGUAGE_NAMES) {
      expect(LANGUAGE_NAME_SET.has(name), name).toBe(true);
    }
  });
});
