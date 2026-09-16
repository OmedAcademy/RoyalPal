import Link from "next/link";
import { CrownGlyph } from "@/components/brand/CrownGlyph";

/**
 * RoyalPal brand mark: a royal-blue tile with an antique-gold crown, paired
 * with the wordmark. Pure inline SVG — no network request, scales crisply,
 * and inherits theme colors from the design tokens.
 */
export function Logo({
  href = "/",
  showWordmark = true,
  size = 36,
  className = "",
}: {
  href?: string | null;
  showWordmark?: boolean;
  size?: number;
  className?: string;
}) {
  const mark = (
    <span className="flex items-center gap-2.5">
      <span
        className="shadow-luxe inline-grid place-items-center rounded-[10px]"
        style={{ width: size, height: size, background: "var(--royal)" }}
        aria-hidden="true"
      >
        <CrownGlyph size={size * 0.62} withJewels />
      </span>
      {showWordmark && (
        <span
          className="text-[1.35rem] font-semibold tracking-tight"
          style={{ letterSpacing: "-0.02em" }}
        >
          Royal<span className="text-royal">Pal</span>
        </span>
      )}
    </span>
  );

  if (href === null) {
    return <span className={className}>{mark}</span>;
  }

  return (
    <Link
      href={href}
      className={`inline-flex items-center ${className}`}
      aria-label="RoyalPal home"
    >
      {mark}
    </Link>
  );
}
