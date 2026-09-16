import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { CrownGlyph } from "@/components/brand/CrownGlyph";

/**
 * Premium two-column auth shell. On large screens a royal brand panel sits
 * beside the form — cream and deep blue, in the spirit of quiet luxury; on
 * smaller screens it collapses to a clean, centered invitation card with
 * the logo above it. Each page supplies the heading, fields, and switch
 * link rendered inside the card.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel — large screens only */}
      <aside className="bg-royal text-royal-contrast relative hidden w-1/2 flex-col justify-between overflow-hidden p-14 lg:flex xl:w-[55%]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(75% 55% at 12% 8%, rgba(255,255,255,0.10) 0%, transparent 60%)",
          }}
        />
        <Link
          href="/"
          className="relative inline-flex items-center gap-2.5"
          aria-label="RoyalPal home"
        >
          <CrownGlyph size={26} />
          <span className="font-display text-2xl font-semibold tracking-tight">
            Royal<span className="text-gold-soft">Pal</span>
          </span>
        </Link>

        <div className="relative max-w-md">
          <h2 className="font-display text-4xl leading-tight font-medium text-balance">
            Teach without borders. Learn without limits.
          </h2>
          <p className="mt-6 leading-relaxed text-white/70">
            Join a global classroom connecting exceptional teachers and learners — and a company
            dedicating half of its profits to lasting good.
          </p>
        </div>

        <p className="relative text-sm tracking-wide text-white/55">
          <span aria-hidden="true" className="text-gold-soft">
            ✦
          </span>{" "}
          Your Digital Classroom. Your Real Future.
        </p>
      </aside>

      {/* Form column */}
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo />
          </div>
          {/* The invitation card: warm surface, platinum hairline, a single
              thread of gold along the top edge. */}
          <div className="rp-rise rp-rise-1 shadow-luxe-lg border-hairline bg-surface overflow-hidden rounded-2xl border">
            <div
              aria-hidden="true"
              className="h-[3px] w-full"
              style={{
                background:
                  "linear-gradient(90deg, transparent, var(--gold-rich) 35%, var(--gold-rich) 65%, transparent)",
              }}
            />
            <div className="p-7 sm:p-9">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
