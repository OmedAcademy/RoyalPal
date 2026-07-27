/** Shared premium form-control styling, used across auth (and reusable
 * elsewhere). Kept as string constants so both server and client components
 * can apply identical, accessible inputs. */

export const fieldLabelClass = "text-sm font-medium text-foreground";

export const fieldInputClass =
  "w-full rounded-xl border border-hairline-strong bg-surface px-3.5 py-2.5 text-sm text-foreground transition-[border-color,box-shadow] duration-200 placeholder:text-muted focus:border-royal focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-[color:var(--ring)]";
