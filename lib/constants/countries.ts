/**
 * Backward-compatible country constants, now backed by the full ISO 3166
 * dataset in lib/i18n. Profile forms and validation import from here.
 *
 * The stored value on a profile is the country's canonical English `name`
 * (unchanged from the legacy list, so existing rows keep validating). The
 * legacy free-text escape hatch "Other" is still accepted so any profile
 * saved before this dataset landed continues to work.
 */
import { COUNTRY_DATA } from "@/lib/i18n/countries";
import { COUNTRY_OPTIONS } from "@/lib/i18n/search";

/** Legacy catch-all value; kept accepted for backward compatibility. */
export const LEGACY_OTHER = "Other";

/** Every valid canonical country name (plus the legacy "Other"). */
export const COUNTRY_NAMES: readonly string[] = [...COUNTRY_DATA.map((c) => c.name), LEGACY_OTHER];

/** O(1) membership set used by validation. */
export const COUNTRY_NAME_SET: ReadonlySet<string> = new Set(COUNTRY_NAMES);

/** Options for a <select>: sovereign states first, each with its flag, then
 * territories/regions/disputed, then the legacy "Other". */
export const COUNTRY_SELECT_OPTIONS: readonly { value: string; label: string }[] = [
  ...COUNTRY_OPTIONS.map((c) => ({ value: c.name, label: `${c.flag} ${c.name}` })),
  { value: LEGACY_OTHER, label: LEGACY_OTHER },
];
