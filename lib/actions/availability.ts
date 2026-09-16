"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { activeUserOrError } from "@/lib/supabase/queries";
import { availabilityRulesSchema } from "@/lib/validations/availability";

export type AvailabilityActionState = {
  error?: string;
  message?: string;
};

/** Replaces a tutor's entire weekly template in one go — simpler and safer
 * than diffing individual rows, matching the tutor_subjects sync pattern
 * used for M4 subject selection. */
export async function updateAvailabilityRules(
  _prevState: AvailabilityActionState,
  formData: FormData,
): Promise<AvailabilityActionState> {
  const parsed = availabilityRulesSchema.safeParse({
    dayOfWeek: formData.getAll("dayOfWeek"),
    startTime: formData.getAll("startTime"),
    endTime: formData.getAll("endTime"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) {
    return { error: auth.error };
  }
  const user = auth.user;

  const { error: deleteError } = await supabase
    .from("availability_rules")
    .delete()
    .eq("tutor_id", user.id);
  if (deleteError) {
    return { error: deleteError.message };
  }

  if (parsed.data.length > 0) {
    const { error: insertError } = await supabase
      .from("availability_rules")
      .insert(parsed.data.map((rule) => ({ ...rule, tutor_id: user.id })));

    if (insertError) {
      return { error: insertError.message };
    }
  }

  revalidatePath("/tutor/availability");

  return { message: "Availability saved" };
}
