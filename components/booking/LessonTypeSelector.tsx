function priceLabel(cents: number, currency: string): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

export function LessonTypeSelector({
  lessonType,
  hourlyRateCents,
  trialPriceCents,
  currency,
}: {
  lessonType: "standard" | "trial";
  hourlyRateCents: number;
  trialPriceCents: number | null;
  currency: string;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="lessonType" className="text-sm font-medium">
          Lesson type
        </label>
        <select
          id="lessonType"
          name="lessonType"
          defaultValue={lessonType}
          className="rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
        >
          <option value="standard">
            Standard lesson (60 min) — {priceLabel(hourlyRateCents, currency)}
          </option>
          {trialPriceCents !== null && (
            <option value="trial">
              Trial lesson (30 min) — {priceLabel(trialPriceCents, currency)}
            </option>
          )}
        </select>
      </div>
      <button
        type="submit"
        className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
      >
        Update
      </button>
    </form>
  );
}
