"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Previous/next links that preserve every other filter.
 *
 * Rendered as real links rather than buttons so a page of results is
 * shareable, bookmarkable, and works with the browser's own back button —
 * which on a phone is the control people actually reach for.
 */
export function SearchPagination({
  page,
  hasMore,
  total,
  pageSize,
  label = "Search results pages",
}: {
  page: number;
  hasMore: boolean;
  total: number;
  pageSize: number;
  /** Named for what is being paged, so a screen reader hears the difference
   * between two pagination controls on the same site. */
  label?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (page === 0 && !hasMore) return null;

  const hrefFor = (nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage <= 0) params.delete("page");
    else params.set("page", String(nextPage));
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3 pt-2">
      {page > 0 ? (
        <Link
          href={hrefFor(page - 1)}
          rel="prev"
          className="border-hairline-strong hover:border-royal inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium"
        >
          ← Previous
        </Link>
      ) : (
        <span />
      )}

      <span className="text-muted text-sm">
        Page {page + 1} of {lastPage + 1}
      </span>

      {hasMore ? (
        <Link
          href={hrefFor(page + 1)}
          rel="next"
          className="border-hairline-strong hover:border-royal inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium"
        >
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
