/**
 * Shared types for the international reference datasets (countries +
 * languages). These datasets are the single source of truth consumed by
 * profile forms, validation, search, and tutor discovery. The design goal
 * is backward compatibility: every canonical `name` that existed in the
 * legacy lib/constants lists is preserved here as a `name` or alias, so no
 * stored profile value is ever orphaned.
 */

/**
 * How an entry relates to sovereignty. Kurdistan Region, Hong Kong, Puerto
 * Rico, etc. are real, selectable entries but are NOT sovereign states —
 * this field lets the UI group and label them correctly instead of
 * silently omitting them or mislabelling them as countries.
 */
export type CountryType =
  | "sovereign" // UN member state
  | "observer" // UN observer state (Vatican, Palestine)
  | "territory" // overseas territory / external territory
  | "dependency" // dependency of a sovereign state
  | "crown-dependency" // UK Crown dependencies (Jersey, Guernsey, Isle of Man)
  | "sar" // Special Administrative Region (Hong Kong, Macau)
  | "region" // sub-sovereign administrative region (Kurdistan Region)
  | "disputed"; // disputed / limited-recognition (Kosovo, Northern Cyprus)

export type Country = {
  /** ISO 3166-1 alpha-2, or a stable non-ISO code (e.g. "XK" Kosovo,
   * "IQ-KR" Kurdistan Region) for entities outside ISO 3166-1. */
  alpha2: string;
  /** ISO 3166-1 alpha-3, or null for non-ISO entities. */
  alpha3: string | null;
  /** ISO 3166-1 numeric, or null for non-ISO entities. */
  numeric: string | null;
  /** Canonical English display name. */
  name: string;
  /** Endonym (name in a primary local language), where available. */
  nativeName: string;
  /** Flag emoji. Usually derived from alpha-2 regional indicators; an
   * explicit value overrides that (for entities with no alpha-2 flag). */
  flag: string;
  type: CountryType;
  /** For sub-sovereign / dependent entities, the alpha-2 of the sovereign
   * state they belong to (e.g. Kurdistan Region -> "IQ"). */
  sovereignAlpha2?: string;
  /** Alternate spellings, demonyms, and short forms used for search
   * (e.g. "Iraqi", "KRG", "Holland", "UAE"). */
  aliases: string[];
};

export type TextDirection = "ltr" | "rtl";

export type Language = {
  /** Primary ISO 639 code: 639-1 (2-letter) where one exists, otherwise
   * 639-3 (3-letter). Used as the stable machine identifier. */
  code: string;
  /** ISO 639-3 code where distinct/known (dialects, minority languages). */
  iso639_3?: string;
  /** Canonical English display name. */
  name: string;
  /** Endonym (the language's name in itself), where available. */
  nativeName: string;
  /** Writing direction of the primary script. */
  direction: TextDirection;
  /** Alternate names and spellings for search (e.g. "Farsi", "Mandarin",
   * "Castilian", "Sorani"). */
  aliases: string[];
};
