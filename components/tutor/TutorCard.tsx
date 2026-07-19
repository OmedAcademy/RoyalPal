import Link from "next/link";
import type { TutorSearchResult } from "@/lib/supabase/tutor-search";
import type { Subject } from "@/types/database";

function priceLabel(cents: number, currency: string): string {
  return `${(cents / 100).toLocaleString(undefined, { style: "currency", currency: currency.toUpperCase() })}/hr`;
}

export function TutorCard({ tutor, subjectsById }: { tutor: TutorSearchResult; subjectsById: Map<number, Subject> }) {
  const initial = tutor.full_name.trim().charAt(0).toUpperCase() || "?";
  const subjectNames = tutor.subject_ids
    .map((id) => subjectsById.get(id)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <Link
      href={`/student/tutors/${tutor.id}`}
      className="flex flex-col gap-3 rounded-md border border-black/10 p-4 transition hover:border-black/30 dark:border-white/10 dark:hover:border-white/30"
    >
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          {tutor.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tutor.avatar_url} alt={tutor.full_name} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-zinc-500">
              {initial}
            </span>
          )}
        </div>
        <div>
          <p className="font-medium">{tutor.full_name}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{tutor.headline}</p>
        </div>
      </div>

      {subjectNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {subjectNames.map((name) => (
            <span
              key={name}
              className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-zinc-700 dark:bg-white/10 dark:text-zinc-300"
            >
              {name}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{priceLabel(tutor.hourly_rate_cents, tutor.currency)}</span>
        {tutor.avg_rating !== null ? (
          <span className="text-zinc-600 dark:text-zinc-400">
            ★ {tutor.avg_rating.toFixed(1)} ({tutor.total_reviews})
          </span>
        ) : (
          <span className="text-zinc-500 dark:text-zinc-500">No reviews yet</span>
        )}
      </div>
    </Link>
  );
}
