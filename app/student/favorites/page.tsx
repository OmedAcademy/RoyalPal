import type { Metadata } from "next";
import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { getTutorsByIds } from "@/lib/supabase/tutor-search";
import { TutorCard } from "@/components/tutor/TutorCard";
import { ButtonLink } from "@/components/ui/Button";
import type { Subject } from "@/types/database";

export const metadata: Metadata = { title: "Saved tutors — RoyalPal" };

export default async function FavoritesPage() {
  const profile = await requireProfile(["student"]);
  const supabase = await createClient();

  const [{ data: favoriteRows }, { data: subjects }] = await Promise.all([
    supabase
      .from("favorites")
      .select("tutor_id, created_at")
      .eq("student_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase.from("subjects").select("*").order("category").order("name"),
  ]);

  const tutors = await getTutorsByIds((favoriteRows ?? []).map((row) => row.tutor_id));
  const subjectsById = new Map<number, Subject>((subjects ?? []).map((s) => [s.id, s]));

  // A saved tutor whose account is no longer approved silently drops out of
  // getTutorsByIds (it filters on verification_status). Saying so is kinder
  // than a list that quietly shrinks.
  const missing = (favoriteRows ?? []).length - tutors.length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Saved tutors
        </h1>
        <p className="text-muted mt-1 text-sm">
          Tutors you&apos;ve saved while browsing. Tap the heart on any profile to add or remove
          one.
        </p>
      </div>

      {tutors.length === 0 ? (
        <div className="border-hairline bg-surface flex flex-col items-start gap-3 rounded-2xl border p-6">
          <p className="font-medium">You haven&apos;t saved any tutors yet.</p>
          <p className="text-muted text-sm">
            Saving a tutor keeps them one tap away when you&apos;re ready to book.
          </p>
          <ButtonLink href="/student/tutors">Find a tutor</ButtonLink>
        </div>
      ) : (
        <>
          {missing > 0 && (
            <p role="status" className="text-muted text-sm">
              {missing} saved {missing === 1 ? "tutor is" : "tutors are"} not currently accepting
              bookings, so {missing === 1 ? "it isn't" : "they aren't"} shown here.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tutors.map((tutor) => (
              <TutorCard key={tutor.id} tutor={tutor} subjectsById={subjectsById} favorited />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
