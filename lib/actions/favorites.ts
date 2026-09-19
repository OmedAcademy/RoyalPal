"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { activeUserOrError } from "@/lib/supabase/queries";
import { consumeRateLimit, rateLimitMessage } from "@/lib/rate-limit/limiter";

export type FavoriteActionState = {
  error?: string;
  /** The state the tutor is in AFTER this call, so the button can render the
   * truth without a refetch. */
  favorited?: boolean;
};

const schema = z.object({ tutorId: z.string().uuid() });

/**
 * Adds or removes a saved tutor.
 *
 * The favorites table has had RLS and grants since migration 0009, and the
 * student dashboard has been reading from it the whole time — there was simply
 * never a write path, so that dashboard section could only ever render empty.
 *
 * Authorization is the database's: favorites_manage_own_or_admin scopes every
 * row to auth.uid(), so a forged tutorId can only ever affect the caller's own
 * saved list. What this action adds on top is the suspension check (Server
 * Actions are addressable independently of the routes they appear on) and a
 * rate limit, because a favourite is one row per click and a click is cheap.
 */
export async function toggleFavorite(
  _prevState: FavoriteActionState,
  formData: FormData,
): Promise<FavoriteActionState> {
  const parsed = schema.safeParse({ tutorId: formData.get("tutorId") });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const auth = await activeUserOrError(supabase);
  if ("error" in auth) return { error: auth.error };

  const limit = await consumeRateLimit("favoriteToggle", auth.user.id);
  if (!limit.allowed) return { error: rateLimitMessage(limit) };

  const { data: existing } = await supabase
    .from("favorites")
    .select("tutor_id")
    .eq("student_id", auth.user.id)
    .eq("tutor_id", parsed.data.tutorId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("student_id", auth.user.id)
      .eq("tutor_id", parsed.data.tutorId);
    if (error) return { error: "Couldn't update your saved tutors. Please try again." };
  } else {
    // The composite primary key makes a double-click idempotent rather than a
    // duplicate-row error, so the upsert is the honest expression of "on".
    const { error } = await supabase
      .from("favorites")
      .upsert(
        { student_id: auth.user.id, tutor_id: parsed.data.tutorId },
        { onConflict: "student_id,tutor_id" },
      );
    if (error) return { error: "Couldn't update your saved tutors. Please try again." };
  }

  revalidatePath("/student/favorites");
  revalidatePath("/student/dashboard");
  revalidatePath("/student/tutors");
  revalidatePath(`/student/tutors/${parsed.data.tutorId}`);

  return { favorited: !existing };
}
