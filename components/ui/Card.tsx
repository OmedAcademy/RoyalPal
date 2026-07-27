import type { ReactNode } from "react";

/**
 * A premium surface panel: warm surface, platinum hairline, restrained
 * shadow. Optional header with a title and an aligned action (e.g. a
 * "View all" link). Used across the dashboards for visual consistency.
 */
export function Card({
  title,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`shadow-luxe border-hairline bg-surface rounded-2xl border p-5 sm:p-6 ${className}`}
    >
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A single metric: small label above a large royal value. */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="shadow-luxe border-hairline bg-surface rounded-2xl border p-5">
      <p className="text-muted text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="font-display text-royal mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="text-muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}
