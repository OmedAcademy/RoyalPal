"use client";

import { useActionState, useState } from "react";
import { updateAvailabilityRules, type AvailabilityActionState } from "@/lib/actions/availability";
import type { AvailabilityRule } from "@/types/database";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const initialState: AvailabilityActionState = {};

type Row = { key: number; dayOfWeek: number; startTime: string; endTime: string };

function toRow(
  rule: Pick<AvailabilityRule, "day_of_week" | "start_time" | "end_time">,
  key: number,
): Row {
  return {
    key,
    dayOfWeek: rule.day_of_week,
    startTime: rule.start_time.slice(0, 5),
    endTime: rule.end_time.slice(0, 5),
  };
}

export function AvailabilityEditor({
  rules,
  timezone,
}: {
  rules: AvailabilityRule[];
  timezone: string;
}) {
  const [state, formAction, pending] = useActionState(updateAvailabilityRules, initialState);
  const [rows, setRows] = useState<Row[]>(() =>
    rules.length > 0
      ? rules.map(toRow)
      : [{ key: 0, dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
  );
  const nextKey = rows.length > 0 ? Math.max(...rows.map((r) => r.key)) + 1 : 0;

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [
      ...current,
      { key: nextKey, dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
    ]);
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Set the hours you&apos;re open for lessons each week, in your profile time zone ({timezone}
        ). On a wide screen each day sits beside the next.
      </p>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Day</label>
              <select
                name="dayOfWeek"
                value={row.dayOfWeek}
                onChange={(e) => updateRow(row.key, { dayOfWeek: Number(e.target.value) })}
                className="min-h-11 rounded-md border border-black/15 bg-transparent px-3 dark:border-white/20"
              >
                {DAY_LABELS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Start</label>
              <input
                type="time"
                name="startTime"
                value={row.startTime}
                onChange={(e) => updateRow(row.key, { startTime: e.target.value })}
                className="min-h-11 rounded-md border border-black/15 bg-transparent px-3 dark:border-white/20"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">End</label>
              <input
                type="time"
                name="endTime"
                value={row.endTime}
                onChange={(e) => updateRow(row.key, { endTime: e.target.value })}
                className="min-h-11 rounded-md border border-black/15 bg-transparent px-3 dark:border-white/20"
              />
            </div>
            <button
              type="button"
              onClick={() => removeRow(row.key)}
              className="min-h-11 rounded-md border border-black/15 px-3 text-sm dark:border-white/20"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="min-h-11 w-fit rounded-md border border-black/15 px-3 text-sm font-medium dark:border-white/20"
      >
        Add time range
      </button>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-foreground text-background min-h-11 w-fit rounded-md px-4 font-medium disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save availability"}
      </button>
    </form>
  );
}
