import type { Metadata } from "next";
import { requireProfile } from "@/lib/supabase/queries";
import { getMyTutorReviews, getTutorRatingSummary } from "@/lib/supabase/reviews";
import { SearchPagination } from "@/components/tutor/SearchPagination";
import { ReviewReplyForm } from "@/components/review/ReviewReplyForm";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Your reviews — RoyalPal" };

/** "Maria Lopez" -> "Maria L." — same treatment as the public profile. */
function reviewerLabel(fullName: string): string {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const lastInitial = rest.length > 0 ? ` ${rest[rest.length - 1].charAt(0).toUpperCase()}.` : "";
  return `${first}${lastInitial}`;
}

export default async function TutorReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const profile = await requireProfile(["tutor"]);
  const { page: pageParam } = await searchParams;
  const requestedPage = Number.parseInt(pageParam ?? "0", 10);

  // The summary comes from tutor_profiles, not from the reviews on screen.
  // Averaging the visible page and printing it as "your average" contradicted
  // the number on this tutor's own public profile, and moved every time a
  // review landed past the twentieth.
  const [{ reviews, page, pageSize, total, hasMore }, summary] = await Promise.all([
    getMyTutorReviews(profile.id, { page: Number.isNaN(requestedPage) ? 0 : requestedPage }),
    getTutorRatingSummary(profile.id),
  ]);

  const average = summary.average === null ? null : summary.average.toFixed(1);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Your reviews
        </h1>
        <p className="text-muted mt-1 text-sm">
          {average
            ? `${average} average from ${summary.total} review${summary.total === 1 ? "" : "s"}.`
            : "Reviews from students you've taught will appear here."}{" "}
          You can reply once to each review.
        </p>
      </div>

      {reviews.length === 0 && page === 0 ? (
        <div className="border-hairline bg-surface rounded-2xl border p-6">
          <p className="font-medium">No reviews yet.</p>
          <p className="text-muted mt-1 text-sm">
            A student can review a lesson once it&apos;s finished and paid for.
          </p>
        </div>
      ) : (
        reviews.map((review) => (
          <article key={review.id} className="border-hairline bg-surface rounded-2xl border p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium">
                <span aria-label={`${review.rating} out of 5`} className="text-amber-500">
                  <span aria-hidden="true">{"★".repeat(review.rating)}</span>
                </span>{" "}
                {reviewerLabel(review.author_name)}
              </p>
              <span className="text-muted text-xs">{formatDate(review.created_at)}</span>
            </div>

            {review.comment ? <p className="mt-2 text-sm">{review.comment}</p> : null}

            {review.tutor_reply ? (
              <div className="border-hairline mt-3 border-l-2 pl-3">
                <p className="text-muted text-xs font-medium">Your reply</p>
                <p className="text-sm">{review.tutor_reply}</p>
              </div>
            ) : (
              <div className="mt-3">
                <ReviewReplyForm reviewId={review.id} />
              </div>
            )}
          </article>
        ))
      )}

      <SearchPagination
        page={page}
        hasMore={hasMore}
        total={total}
        pageSize={pageSize}
        label="Review pages"
      />
    </div>
  );
}
