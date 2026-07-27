import { notFound } from "next/navigation";
import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { getTutorById } from "@/lib/supabase/tutor-search";
import { getTutorReviews } from "@/lib/supabase/reviews";
import { safeExternalUrl } from "@/lib/utils/url";

function priceLabel(cents: number, currency: string): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

/** "Maria Lopez" -> "Maria L." — public review lists shouldn't broadcast a
 * student's full surname. */
function reviewerLabel(fullName: string): string {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const lastInitial = rest.length > 0 ? ` ${rest[rest.length - 1].charAt(0).toUpperCase()}.` : "";
  return `${first}${lastInitial}`;
}

export default async function TutorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["student"]);
  const { id } = await params;

  const tutor = await getTutorById(id);
  if (!tutor) {
    notFound();
  }

  const supabase = await createClient();
  const [{ data: subjects }, reviews] = await Promise.all([
    tutor.subject_ids.length
      ? supabase.from("subjects").select("*").in("id", tutor.subject_ids)
      : Promise.resolve({ data: [] }),
    getTutorReviews(id),
  ]);

  const initial = tutor.full_name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          {tutor.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tutor.avatar_url}
              alt={tutor.full_name}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-2xl font-semibold text-zinc-500">
              {initial}
            </span>
          )}
        </div>
        <div>
          <h1 className="text-xl font-semibold">{tutor.full_name}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{tutor.headline}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-zinc-500 dark:text-zinc-400">Hourly rate</p>
          <p className="font-medium">{priceLabel(tutor.hourly_rate_cents, tutor.currency)}</p>
        </div>
        {tutor.trial_price_cents !== null && (
          <div>
            <p className="text-zinc-500 dark:text-zinc-400">Trial lesson</p>
            <p className="font-medium">{priceLabel(tutor.trial_price_cents, tutor.currency)}</p>
          </div>
        )}
        <div>
          <p className="text-zinc-500 dark:text-zinc-400">Rating</p>
          <p className="font-medium">
            {tutor.avg_rating !== null
              ? `★ ${tutor.avg_rating.toFixed(1)} (${tutor.total_reviews})`
              : "No reviews yet"}
          </p>
        </div>
      </div>

      {subjects && subjects.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium">Subjects</h2>
          <div className="flex flex-wrap gap-1.5">
            {subjects.map((subject) => (
              <span
                key={subject.id}
                className="rounded-full bg-black/5 px-2.5 py-1 text-xs text-zinc-700 dark:bg-white/10 dark:text-zinc-300"
              >
                {subject.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {tutor.teaching_languages.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-medium">Teaches in</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {tutor.teaching_languages.join(", ")}
          </p>
        </div>
      )}

      {tutor.specializations.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-medium">Specializations</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {tutor.specializations.join(", ")}
          </p>
        </div>
      )}

      <div>
        <h2 className="mb-1 text-sm font-medium">About</h2>
        <p className="text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{tutor.bio}</p>
      </div>

      {/* Re-validated at render: rows saved before scheme validation existed
          may still hold a `javascript:` URL, and this is a public page. */}
      {safeExternalUrl(tutor.video_url) && (
        <a
          href={safeExternalUrl(tutor.video_url)!}
          target="_blank"
          rel="noreferrer"
          className="w-fit text-sm font-medium underline underline-offset-2"
        >
          Watch intro video
        </a>
      )}

      <Link
        href={`/student/tutors/${tutor.id}/book`}
        className="bg-foreground text-background w-fit rounded-md px-4 py-2 font-medium"
      >
        Book a lesson
      </Link>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          Reviews{" "}
          {tutor.avg_rating !== null && (
            <span className="font-normal text-zinc-500 dark:text-zinc-400">
              · ★ {tutor.avg_rating.toFixed(1)} ({tutor.total_reviews})
            </span>
          )}
        </h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No reviews yet — be the first after your lesson.
          </p>
        ) : (
          reviews.map((review) => (
            <div
              key={review.id}
              className="flex flex-col gap-1 rounded-md border border-black/10 p-3 dark:border-white/10"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-label={`${review.rating} out of 5 stars`}
                  className="text-sm text-amber-500"
                >
                  {"★".repeat(review.rating)}
                  <span className="text-zinc-300 dark:text-zinc-600">
                    {"★".repeat(5 - review.rating)}
                  </span>
                </span>
                <span className="text-sm font-medium">{reviewerLabel(review.author_name)}</span>
                <span className="text-xs text-zinc-500">
                  {new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(
                    new Date(review.created_at),
                  )}
                </span>
              </div>
              {review.comment && (
                <p className="text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
                  {review.comment}
                </p>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
