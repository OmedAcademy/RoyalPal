import { SelectField } from "@/components/ui/SelectField";
import { TextField } from "@/components/ui/TextField";
import { LANGUAGES } from "@/lib/constants/languages";
import type { Subject } from "@/types/database";

export function TutorFilters({
  subjects,
  defaultSubjectId,
  defaultLanguage,
  defaultMaxPrice,
}: {
  subjects: Subject[];
  defaultSubjectId: string;
  defaultLanguage: string;
  defaultMaxPrice: string;
}) {
  return (
    <form method="get" className="grid gap-4 sm:grid-cols-4 sm:items-end">
      <SelectField
        label="Subject"
        name="subject"
        options={subjects.map((s) => ({ value: String(s.id), label: s.name }))}
        defaultValue={defaultSubjectId}
        placeholder="Any subject"
      />
      <SelectField
        label="Teaches in"
        name="language"
        options={LANGUAGES}
        defaultValue={defaultLanguage}
        placeholder="Any language"
      />
      <TextField
        label="Max price (USD/hr)"
        name="maxPrice"
        type="number"
        min={1}
        step={1}
        defaultValue={defaultMaxPrice || null}
        placeholder="No limit"
      />
      <button
        type="submit"
        className="bg-foreground text-background h-fit w-fit rounded-md px-4 py-2 font-medium"
      >
        Search
      </button>
    </form>
  );
}
