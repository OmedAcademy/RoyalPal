import { addDays, zonedTimeToUtc } from "@/lib/utils/timezone";

export type AvailabilityRuleInput = {
  day_of_week: number;
  start_time: string;
  end_time: string;
};

export type AvailabilityExceptionInput = {
  date: string;
  start_time: string | null;
  end_time: string | null;
  is_available: boolean;
};

export type BusyRangeInput = {
  start_at: string;
  end_at: string;
};

export type AvailableSlot = {
  startAt: Date;
  endAt: Date;
};

const SLOT_GRID_MINUTES = 30;

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

type Window = { startMin: number; endMin: number };

function subtractRange(windows: Window[], remove: Window): Window[] {
  const result: Window[] = [];
  for (const w of windows) {
    if (remove.endMin <= w.startMin || remove.startMin >= w.endMin) {
      result.push(w);
      continue;
    }
    if (remove.startMin > w.startMin) {
      result.push({ startMin: w.startMin, endMin: Math.min(remove.startMin, w.endMin) });
    }
    if (remove.endMin < w.endMin) {
      result.push({ startMin: Math.max(remove.endMin, w.startMin), endMin: w.endMin });
    }
  }
  return result;
}

/** Computes bookable start times for the next `days` days, sized to
 * `durationMinutes`, from a tutor's recurring weekly rules layered with
 * one-off exceptions and existing bookings.
 *
 * `rules`/`exceptions` times are wall-clock in `timeZone` (the tutor's own
 * timezone — see tutor_profiles/profiles). `busyRanges` are actual UTC
 * instants (existing bookings) subtracted after the per-day window math. */
export function computeAvailableSlots({
  rules,
  exceptions,
  busyRanges,
  timeZone,
  startDate,
  days,
  durationMinutes,
  now = new Date(),
}: {
  rules: AvailabilityRuleInput[];
  exceptions: AvailabilityExceptionInput[];
  busyRanges: BusyRangeInput[];
  timeZone: string;
  startDate: string;
  days: number;
  durationMinutes: number;
  now?: Date;
}): AvailableSlot[] {
  const slots: AvailableSlot[] = [];
  const busy = busyRanges.map((b) => ({
    start: new Date(b.start_at).getTime(),
    end: new Date(b.end_at).getTime(),
  }));

  for (let offset = 0; offset < days; offset++) {
    const date = addDays(startDate, offset);
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
    const dayExceptions = exceptions.filter((e) => e.date === date);

    if (
      dayExceptions.some((e) => !e.is_available && e.start_time === null && e.end_time === null)
    ) {
      continue;
    }

    let windows: Window[] = rules
      .filter((r) => r.day_of_week === dayOfWeek)
      .map((r) => ({ startMin: toMinutes(r.start_time), endMin: toMinutes(r.end_time) }));

    for (const exception of dayExceptions) {
      if (exception.start_time === null || exception.end_time === null) continue;
      const range = {
        startMin: toMinutes(exception.start_time),
        endMin: toMinutes(exception.end_time),
      };
      windows = exception.is_available ? [...windows, range] : subtractRange(windows, range);
    }

    for (const window of windows) {
      for (
        let slotStartMin = window.startMin;
        slotStartMin + durationMinutes <= window.endMin;
        slotStartMin += SLOT_GRID_MINUTES
      ) {
        const startTime = `${String(Math.floor(slotStartMin / 60)).padStart(2, "0")}:${String(slotStartMin % 60).padStart(2, "0")}`;
        const endMin = slotStartMin + durationMinutes;
        const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

        const startAt = zonedTimeToUtc(date, startTime, timeZone);
        const endAt = zonedTimeToUtc(date, endTime, timeZone);

        if (startAt.getTime() <= now.getTime()) continue;
        if (busy.some((b) => startAt.getTime() < b.end && endAt.getTime() > b.start)) continue;

        slots.push({ startAt, endAt });
      }
    }
  }

  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
