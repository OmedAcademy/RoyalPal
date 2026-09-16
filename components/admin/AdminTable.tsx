import type { ReactNode } from "react";

/**
 * A horizontally-scrollable table shell with consistent admin styling. The
 * page supplies header cells and rows; this handles the chrome, the
 * overflow container (so wide tables never break the page layout), and the
 * empty state.
 */
export function AdminTable({
  head,
  children,
  empty = "Nothing to show yet.",
  isEmpty,
}: {
  head: ReactNode;
  children: ReactNode;
  empty?: string;
  isEmpty: boolean;
}) {
  if (isEmpty) {
    return (
      <div className="shadow-luxe border-hairline bg-surface text-muted rounded-2xl border p-8 text-center text-sm">
        {empty}
      </div>
    );
  }

  return (
    <div className="shadow-luxe border-hairline bg-surface overflow-x-auto rounded-2xl border">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-hairline text-muted border-b text-xs tracking-wide uppercase">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--hairline)]">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={`px-4 py-3 font-medium ${className}`}>{children}</th>;
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}
