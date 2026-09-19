"use client";

import { useActionState, useState } from "react";
import { rescheduleBooking, type BookingActionState } from "@/lib/actions/booking";
import { Button } from "@/components/ui/Button";
import type { SlotGroup } from "@/components/booking/RescheduleView";

const initialState: BookingActionState = {};

export function RescheduleForm({
  bookingId,
  groups,
  timeZoneLabel,
}: {
  bookingId: string;
  groups: SlotGroup[];
  timeZoneLabel: string;
}) {
  const [state, formAction, pending] = useActionState(rescheduleBooking, initialState);
  const [selected, setSelected] = useState<string>("");

  if (state.message) {
    return (
      <p
        role="status"
        className="rounded-xl border border-green-600/25 bg-green-500/5 px-4 py-4 text-sm leading-relaxed text-green-700 dark:text-green-400"
      >
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="startAt" value={selected} />

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-medium">
          Choose a new time{" "}
          <span className="text-muted font-normal">(times shown in {timeZoneLabel})</span>
        </legend>

        {groups.map((group) => (
          <div key={group.date} className="flex flex-col gap-2">
            <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
              {group.label}
            </h2>
            <div className="flex flex-wrap gap-2">
              {group.slots.map((slot) => {
                const active = selected === slot.startAt;
                return (
                  <label
                    key={slot.startAt}
                    className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition-colors ${
                      active
                        ? "border-royal bg-royal text-royal-contrast"
                        : "border-hairline-strong hover:border-royal"
                    }`}
                  >
                    <input
                      type="radio"
                      name="slot"
                      value={slot.startAt}
                      checked={active}
                      onChange={() => setSelected(slot.startAt)}
                      className="sr-only"
                    />
                    {slot.label}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reschedule-reason" className="text-sm font-medium">
          Why are you moving it? <span className="text-muted font-normal">(optional)</span>
        </label>
        <textarea
          id="reschedule-reason"
          name="reason"
          rows={2}
          maxLength={500}
          placeholder="We'll pass this on to the other person."
          className="border-hairline-strong bg-surface focus:border-royal w-full resize-y rounded-xl border px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-[color:var(--ring)] focus:outline-none"
        />
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          {state.error}
        </p>
      )}

      <Button
        type="submit"
        disabled={pending || !selected}
        aria-busy={pending}
        className="self-start"
      >
        {pending ? "Moving…" : "Move lesson"}
      </Button>
    </form>
  );
}
