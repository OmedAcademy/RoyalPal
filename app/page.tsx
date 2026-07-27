import type { Metadata } from "next";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { ButtonLink } from "@/components/ui/Button";
import { CrownGlyph } from "@/components/brand/CrownGlyph";

export const metadata: Metadata = {
  title: "RoyalPal — Teach Without Borders. Learn Without Limits.",
  description:
    "RoyalPal connects exceptional teachers and learners across the world — a global classroom built to create lasting positive impact.",
};

const PILLARS = [
  { icon: "📚", label: "Education" },
  { icon: "💧", label: "Clean Water" },
  { icon: "🌳", label: "Environmental Restoration" },
  { icon: "🏠", label: "Vulnerable Communities" },
];

function GoldDivider({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block h-px w-20 ${className}`}
      style={{ background: "linear-gradient(90deg, transparent, var(--gold-rich), transparent)" }}
    />
  );
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* ---- Hero ---- */}
        <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 pt-24 pb-8 text-center sm:pt-32">
          <CrownGlyph size={34} withJewels className="rp-rise rp-rise-1" />

          <h1
            className="rp-rise rp-rise-2 font-display text-gold-foil mt-8 text-5xl leading-[1.06] font-semibold sm:text-6xl lg:text-7xl"
            style={{ letterSpacing: "-0.015em" }}
          >
            Teach Without Borders.
            <br />
            Learn Without Limits.
          </h1>

          <GoldDivider className="mt-9" />

          <p className="rp-rise rp-rise-3 font-display text-foreground mt-8 text-2xl leading-snug sm:text-3xl">
            Your Digital Classroom.
            <br />
            Your Real Future.
          </p>

          <div className="rp-rise rp-rise-4 mt-12 flex flex-col items-center gap-3 sm:flex-row">
            <ButtonLink href="/login" size="lg" className="w-full sm:w-auto">
              Sign In
            </ButtonLink>
            <ButtonLink href="/signup" variant="secondary" size="lg" className="w-full sm:w-auto">
              Create Account
            </ButtonLink>
          </div>
        </section>

        {/* ---- Mission ---- */}
        <section className="mx-auto w-full max-w-2xl px-6 py-24 text-center sm:py-32">
          <p className="font-display text-foreground text-2xl leading-snug italic sm:text-3xl">
            Every lesson creates opportunity.
          </p>

          <p className="text-muted mt-8 text-base leading-relaxed sm:text-lg">
            As RoyalPal grows, we are committed to creating lasting impact beyond the classroom.
          </p>

          <p className="text-muted mt-6 text-base leading-relaxed sm:text-lg">
            After all legitimate operating expenses, taxes, and business obligations have been
            fulfilled, RoyalPal will dedicate{" "}
            <span className="text-royal font-semibold">50% of its annual net profits</span> to
            charitable initiatives supporting:
          </p>

          <GoldDivider className="mx-auto mt-12" />

          <ul className="mx-auto mt-12 flex max-w-xl flex-wrap items-center justify-center gap-x-10 gap-y-7">
            {PILLARS.map((pillar) => (
              <li key={pillar.label} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="border-hairline bg-surface inline-grid h-11 w-11 place-items-center rounded-full border text-xl"
                >
                  {pillar.icon}
                </span>
                <span className="text-foreground text-sm font-medium tracking-wide">
                  {pillar.label}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-14">
            <ButtonLink href="/our-impact" variant="secondary" size="lg">
              Explore our impact
            </ButtonLink>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
