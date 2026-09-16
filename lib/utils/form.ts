/** Values from a repeated-name field, e.g. multiple checkboxes sharing a name. */
export function getStringArray(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map((value) => String(value).trim())
    .filter(Boolean);
}

/** One entry per non-empty line, for freeform "one per line" textareas
 * (e.g. certifications). */
export function parseLines(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
