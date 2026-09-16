/**
 * Backward-compatible language constants, now backed by the comprehensive
 * ISO 639 dataset in lib/i18n (Kurdish and all its variants included).
 * Profile forms, tutor filters, and validation import from here.
 *
 * The stored value on a profile is the language's canonical English `name`
 * (every legacy name is preserved in the dataset, so existing rows keep
 * validating and nothing disappears).
 */
import { LANGUAGE_DATA } from "@/lib/i18n/languages";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/search";

/** Every valid canonical language name. */
export const LANGUAGE_NAMES: readonly string[] = LANGUAGE_DATA.map((l) => l.name);

/** O(1) membership set used by validation. */
export const LANGUAGE_NAME_SET: ReadonlySet<string> = new Set(LANGUAGE_NAMES);

/** Options for a <select> / checkbox group, alphabetical by English name. */
export const LANGUAGE_SELECT_OPTIONS: readonly { value: string; label: string }[] =
  LANGUAGE_OPTIONS.map((l) => ({ value: l.name, label: l.name }));
