"use client";

import { useActionState, useState } from "react";
import { createBooking, type BookingActionState } from "@/lib/actions/booking";
import { SelectField } from "@/components/ui/SelectField";

const initialState: BookingActionState = {};

export type SlotGroup = {
  date: string;
  label: string;
  slots: { startAt: string; label: string }[];
};

export function BookingForm({
  tutorId,
  subjects,
  slotGroups,
  durationMinutes,
  lessonType,
}: {
  tutorId: string;
  subjects: { value: string; label: string }[];
  slotGroups: SlotGroup[];
  durationMinutes: number;
  lessonType: "standard" | "trial";
}) {
  const [state, formAction, pending] = useActionState(createBooking, initialState);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="tutorId" value={tutorId} />
      <input type="hidden" name="durationMinutes" value={durationMinutes} />
      <input type="hidden" name="lessonType" value={lessonType} />
      <input type="hidden" name="startAt" value={selectedSlot ?? ""} />

      <SelectField label="Subject" name="subjectId" options={subjects} required />

      {slotGroups.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No open times in the next two weeks for this lesson length.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {slotGroups.map((group) => (
            <div key={group.date}>
              <p className="mb-2 text-sm font-medium">{group.label}</p>
              <div className="flex flex-wrap gap-2">
                {group.slots.map((slot) => (
                  <button
                    key={slot.startAt}
                    type="button"
                    onClick={() => setSelectedSlot(slot.startAt)}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      selectedSlot === slot.startAt
                        ? "border-foreground bg-foreground text-background"
                        : "border-black/15 dark:border-white/20"
                    }`}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !selectedSlot}
        className="bg-foreground text-background w-fit rounded-md px-4 py-2 font-medium disabled:opacity-60"
      >
        {pending ? "Booking..." : "Confirm booking"}
      </button>
    </form>
  );
}
