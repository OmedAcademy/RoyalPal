import { listReviews } from "@/lib/supabase/admin-data";
import { AdminTable, Th, Td } from "@/components/admin/AdminTable";
import { formatDate } from "@/lib/utils/format";

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5`} className="whitespace-nowrap text-amber-500">
      {"★".repeat(rating)}
      <span className="text-slate-300">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export default async function AdminReviewsPage() {
  const reviews = await listReviews();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Reviews moderation</h1>
      <p className="text-muted -mt-2 text-sm">
        Reviews are immutable by design. Hiding/removal (with an audit trail) requires a moderation
        policy migration — planned.
      </p>

      <AdminTable
        isEmpty={reviews.length === 0}
        empty="No reviews yet."
        head={
          <>
            <Th>Rating</Th>
            <Th>Comment</Th>
            <Th>Student</Th>
            <Th>Tutor</Th>
            <Th>Date</Th>
          </>
        }
      >
        {reviews.map((r) => (
          <tr key={r.id}>
            <Td>
              <Stars rating={r.rating} />
            </Td>
            <Td className="text-muted max-w-md">{r.comment ?? "—"}</Td>
            <Td className="whitespace-nowrap">{r.student_name}</Td>
            <Td className="whitespace-nowrap">{r.tutor_name}</Td>
            <Td className="text-muted whitespace-nowrap">{formatDate(r.created_at)}</Td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
