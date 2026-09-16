import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time");

export const availabilityRulesSchema = z
  .object({
    dayOfWeek: z.array(z.coerce.number().int().min(0).max(6)),
    startTime: z.array(time),
    endTime: z.array(time),
  })
  .superRefine((data, ctx) => {
    if (
      data.dayOfWeek.length !== data.startTime.length ||
      data.startTime.length !== data.endTime.length
    ) {
      ctx.addIssue({ code: "custom", message: "Mismatched row counts" });
      return;
    }
    data.startTime.forEach((start, i) => {
      if (data.endTime[i] <= start) {
        ctx.addIssue({
          code: "custom",
          message: `Row ${i + 1}: end time must be after start time`,
        });
      }
    });
  })
  .transform((data) =>
    data.dayOfWeek.map((day, i) => ({
      day_of_week: day,
      start_time: data.startTime[i],
      end_time: data.endTime[i],
    })),
  );

export type AvailabilityRulesInput = z.input<typeof availabilityRulesSchema>;
