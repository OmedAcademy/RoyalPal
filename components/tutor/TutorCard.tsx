import Link from "next/link";
import type { TutorSearchResult } from "@/lib/supabase/tutor-search";
import type { Subject } from "@/types/database";
import { formatMoney } from "@/lib/utils/format";
import { FavoriteButton } from "@/components/tutor/FavoriteButton";

/**
 * The card used to be a single <Link>, which made adding a save button
 * impossible: a <form> (or any control) nested inside an anchor is invalid
 * HTML and browsers resolve it by swallowing clicks on one or the other.
 *
 * The fix is the "stretched link" pattern — the anchor is absolutely
 * positioned over the whole card and carries screen-reader-only text, while
 * interactive children sit above it with `relative z-10`. Keyboard users get
 * one link and one button in a sensible order; pointer users get a fully
 * clickable card with a save button that actually receives its own clicks.
 */
export function TutorCard({
  tutor,
  subjectsById,
  favorited = false,
  showFavorite = true,
}: {
  tutor: TutorSearchResult;
  subjectsById: Map<number, Subject>;
  favorited?: boolean;
  showFavorite?: boolean;
}) {
  const initial = tutor.full_name.trim().charAt(0).toUpperCase() || "?";
  const subjectNames = tutor.subject_ids
    .map((id) => subjectsById.get(id)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="shadow-luxe border-hairline bg-surface hover:border-royal focus-within:border-royal relative flex flex-col gap-3 rounded-2xl border p-4 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5">
      <Link href={`/student/tutors/${tutor.id}`} className="absolute inset-0 rounded-2xl">
        <span className="sr-only">View {tutor.full_name}&apos;s profile</span>
      </Link>

      <div className="flex items-center gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-[color:var(--hairline)]">
          {tutor.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tutor.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="text-muted flex h-full w-full items-center justify-center text-lg font-semibold"
            >
              {initial}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{tutor.full_name}</p>
          <p className="text-muted truncate text-sm">{tutor.headline}</p>
        </div>
        {showFavorite && (
          <div className="relative z-10">
            <FavoriteButton
              tutorId={tutor.id}
              initialFavorited={favorited}
              tutorName={tutor.full_name}
            />
          </div>
        )}
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
            <span aria-hidden="true" className="text-amber-500">
              ★
            </span>{" "}
            {tutor.avg_rating.toFixed(1)} <span className="sr-only">out of 5 from</span>(
            {tutor.total_reviews}
            <span className="sr-only"> reviews</span>)
          </span>
        ) : (
          <span className="text-muted">No reviews yet</span>
        )}
      </div>
    </div>
  );
}
