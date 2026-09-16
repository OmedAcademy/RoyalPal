import { COUNTRY_DATA } from "./countries";
import { LANGUAGE_DATA } from "./languages";
import type { Country, Language, TextDirection } from "./types";

/**
 * Unicode-aware normalization for search and comparison:
 *  - NFD-decompose then strip combining marks, so "Réunion" matches
 *    "reunion" and "Côte d'Ivoire" matches "cote d ivoire".
 *  - lowercase (locale-independent) for case-insensitive matching.
 *  - collapse non-alphanumeric runs (including apostrophes/hyphens) to
 *    single spaces so "Guinea-Bissau" matches "guinea bissau".
 * Non-Latin scripts (Arabic, CJK, Cyrillic) have no combining marks
 * stripped here beyond NFD normalization, so native-name matching against
 * e.g. "کوردستان" still works exactly.
 */
export function normalizeSearch(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

type Indexed<T> = {
  item: T;
  /** Pre-normalized haystacks, most-specific first. */
  primary: string; // canonical name
  native: string;
  codes: string[];
  aliases: string[];
};

function buildCountryIndex(): Indexed<Country>[] {
  return COUNTRY_DATA.map((item) => ({
    item,
    primary: normalizeSearch(item.name),
    native: normalizeSearch(item.nativeName),
    codes: [item.alpha2, item.alpha3 ?? "", item.numeric ?? ""]
      .filter(Boolean)
      .map(normalizeSearch),
    aliases: item.aliases.map(normalizeSearch),
  }));
}

function buildLanguageIndex(): Indexed<Language>[] {
  return LANGUAGE_DATA.map((item) => ({
    item,
    primary: normalizeSearch(item.name),
    native: normalizeSearch(item.nativeName),
    codes: [item.code, item.iso639_3 ?? ""].filter(Boolean).map(normalizeSearch),
    aliases: item.aliases.map(normalizeSearch),
  }));
}

// Built once at module load — the datasets are static.
const COUNTRY_INDEX = buildCountryIndex();
const LANGUAGE_INDEX = buildLanguageIndex();

/**
 * Scores a normalized query against one indexed entry. Higher is better;
 * 0 means no match. Ranking favours exact/prefix hits on the canonical
 * name and codes over substring hits in aliases or native names.
 */
function score<T>(entry: Indexed<T>, q: string): number {
  if (!q) return 1; // empty query: everything matches (used for full lists)

  if (entry.codes.includes(q)) return 100;
  if (entry.primary === q) return 95;
  if (entry.aliases.includes(q)) return 90;
  if (entry.native === q) return 88;

  if (entry.primary.startsWith(q)) return 80;
  if (entry.native.startsWith(q)) return 72;
  if (entry.aliases.some((a) => a.startsWith(q))) return 70;

  if (entry.primary.includes(q)) return 60;
  if (entry.aliases.some((a) => a.includes(q))) return 52;
  if (entry.native.includes(q)) return 50;

  return 0;
}

function runSearch<T>(index: Indexed<T>[], query: string, limit?: number): T[] {
  const q = normalizeSearch(query);
  const scored: { item: T; s: number; name: string }[] = [];

  for (const entry of index) {
    const s = score(entry, q);
    if (s > 0) scored.push({ item: entry.item, s, name: entry.primary });
  }

  scored.sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));
  const items = scored.map((r) => r.item);
  return typeof limit === "number" ? items.slice(0, limit) : items;
}

// ---- Public search API ----------------------------------------------------

export function searchCountries(query: string, limit?: number): Country[] {
  return runSearch(COUNTRY_INDEX, query, limit);
}

export function searchLanguages(query: string, limit?: number): Language[] {
  return runSearch(LANGUAGE_INDEX, query, limit);
}

// ---- Lookups (O(1)) -------------------------------------------------------

const COUNTRY_BY_NAME = new Map(COUNTRY_DATA.map((c) => [normalizeSearch(c.name), c]));
const COUNTRY_BY_CODE = new Map<string, Country>();
for (const c of COUNTRY_DATA) {
  COUNTRY_BY_CODE.set(c.alpha2.toUpperCase(), c);
  if (c.alpha3) COUNTRY_BY_CODE.set(c.alpha3.toUpperCase(), c);
}

const LANGUAGE_BY_NAME = new Map(LANGUAGE_DATA.map((l) => [normalizeSearch(l.name), l]));
const LANGUAGE_BY_CODE = new Map<string, Language>();
for (const l of LANGUAGE_DATA) {
  LANGUAGE_BY_CODE.set(l.code.toLowerCase(), l);
  if (l.iso639_3) LANGUAGE_BY_CODE.set(l.iso639_3.toLowerCase(), l);
}

export function countryByName(name: string): Country | undefined {
  return COUNTRY_BY_NAME.get(normalizeSearch(name));
}

export function countryByCode(code: string): Country | undefined {
  return COUNTRY_BY_CODE.get(code.toUpperCase());
}

export function languageByName(name: string): Language | undefined {
  return LANGUAGE_BY_NAME.get(normalizeSearch(name));
}

export function languageByCode(code: string): Language | undefined {
  return LANGUAGE_BY_CODE.get(code.toLowerCase());
}

/**
 * Writing direction for a language identified by its canonical name
 * (as stored on profiles). Defaults to "ltr" for unknown values so a
 * legacy/free-text value never breaks layout. Consumed by the RTL work in
 * a later phase; exposed now so the data layer is the single source.
 */
export function languageDirection(name: string): TextDirection {
  return languageByName(name)?.direction ?? "ltr";
}

// ---- Sorted option lists (for pickers) ------------------------------------

/** Countries sorted for display: sovereign states first (alphabetical),
 * then everything else (territories, regions, disputed) alphabetically —
 * so the common case tops the list without hiding the long tail. */
export const COUNTRY_OPTIONS: readonly Country[] = [...COUNTRY_DATA].sort((a, b) => {
  const aSov = a.type === "sovereign" ? 0 : 1;
  const bSov = b.type === "sovereign" ? 0 : 1;
  return aSov - bSov || a.name.localeCompare(b.name);
});

export const LANGUAGE_OPTIONS: readonly Language[] = [...LANGUAGE_DATA].sort((a, b) =>
  a.name.localeCompare(b.name),
);
