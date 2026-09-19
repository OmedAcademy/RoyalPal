import type { Metadata } from "next";
import { listReviews } from "@/lib/supabase/admin-data";
import { AdminTable, Th, Td } from "@/components/admin/AdminTable";
import { ReviewModerationActions } from "@/components/admin/ReviewModerationActions";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Reviews — RoyalPal Admin" };

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5`} className="whitespace-nowrap text-amber-500">
      <span aria-hidden="true">
        {"★".repeat(rating)}
        <span className="text-slate-300">{"★".repeat(5 - rating)}</span>
      </span>
    </span>
  );
}

export default async function AdminReviewsPage() {
  const reviews = await listReviews();
  const hiddenCount = reviews.filter((r) => r.hidden_at !== null).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Reviews moderation
        </h1>
        <p className="text-muted mt-1 text-sm">
          Reviews cannot be edited — not by their author, not by the tutor, not here. Hiding one
          keeps the row and its text but removes it from the tutor&apos;s public profile and from
          their rating. The author is told; the tutor is not.
          {hiddenCount > 0 ? ` ${hiddenCount} currently hidden.` : ""}
        </p>
      </div>

      <AdminTable
        isEmpty={reviews.length === 0}
        empty="No reviews yet."
        head={
          <>
            <Th>Rating</Th>
            <Th>Review</Th>
            <Th>Student</Th>
            <Th>Tutor</Th>
            <Th>When</Th>
            <Th>Moderation</Th>
          </>
        }
      >
        {reviews.map((review) => (
          <tr key={review.id} className={review.hidden_at ? "opacity-60" : undefined}>
            <Td>
              <Stars rating={review.rating} />
            </Td>
            <Td className="max-w-xs">
              <span className="block truncate">{review.comment ?? "—"}</span>
              {review.tutor_reply ? (
                <span className="text-muted block truncate text-xs italic">
                  Reply: {review.tutor_reply}
                </span>
              ) : null}
            </Td>
            <Td className="text-muted">{review.student_name}</Td>
            <Td className="text-muted">{review.tutor_name}</Td>
            <Td className="text-muted whitespace-nowrap">{formatDate(review.created_at)}</Td>
            <Td>
              <ReviewModerationActions
                reviewId={review.id}
                hidden={review.hidden_at !== null}
                hiddenReason={review.hidden_reason}
              />
            </Td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
