import Link from "next/link";
import type { TutorSearchResult } from "@/lib/supabase/tutor-search";
import type { Subject } from "@/types/database";
import { formatMoney } from "@/lib/utils/format";

export function TutorCard({
  tutor,
  subjectsById,
}: {
  tutor: TutorSearchResult;
  subjectsById: Map<number, Subject>;
}) {
  const initial = tutor.full_name.trim().charAt(0).toUpperCase() || "?";
  const subjectNames = tutor.subject_ids
    .map((id) => subjectsById.get(id)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <Link
      href={`/student/tutors/${tutor.id}`}
      className="shadow-luxe border-hairline bg-surface hover:border-royal flex flex-col gap-3 rounded-2xl border p-4 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-[color:var(--hairline)]">
          {tutor.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tutor.avatar_url}
              alt={tutor.full_name}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-muted flex h-full w-full items-center justify-center text-lg font-semibold">
              {initial}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{tutor.full_name}</p>
          <p className="text-muted truncate text-sm">{tutor.headline}</p>
        </div>
      </div>

      {subjectNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {subjectNames.map((name) => (
            <span
              key={name}
              className="text-muted-strong rounded-full bg-[color:var(--hairline)] px-2 py-0.5 text-xs"
            >
              {name}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {formatMoney(tutor.hourly_rate_cents, tutor.currency)}
          <span className="text-muted">/hr</span>
        </span>
        {tutor.avg_rating !== null ? (
          <span className="text-muted">
            <span className="text-amber-500">★</span> {tutor.avg_rating.toFixed(1)} (
            {tutor.total_reviews})
          </span>
        ) : (
          <span className="text-muted">No reviews yet</span>
        )}
      </div>
    </Link>
  );
}
