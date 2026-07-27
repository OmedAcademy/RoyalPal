import type { Metadata } from "next";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Our Impact — RoyalPal",
  description:
    "Education changes lives. RoyalPal dedicates half of its net profits to expanding education, clean water, environmental restoration, and support for vulnerable communities.",
};

// Placeholder figures — shown as aspirations, clearly not yet audited.
const STATS = [
  { label: "Teachers Empowered", value: "—" },
  { label: "Students Helped", value: "—" },
  { label: "Lessons Delivered", value: "—" },
  { label: "Countries Reached", value: "—" },
  { label: "Trees Planted", value: "—" },
  { label: "Water Projects Supported", value: "—" },
  { label: "Communities Impacted", value: "—" },
];

const PILLARS = [
  {
    icon: "📚",
    title: "Education",
    body: "Great teaching is the most durable gift there is. We reinvest in programs that put exceptional learning within reach of students who would otherwise go without — scholarships, access, and support for teachers building their livelihoods.",
  },
  {
    icon: "💧",
    title: "Clean Water",
    body: "Nothing else works without it. We back projects that bring safe, reliable water to communities, because a child who is healthy and hydrated is a child who can learn.",
  },
  {
    icon: "🌳",
    title: "Environmental Restoration",
    body: "The future we are educating people for has to be worth inheriting. We invest in reforestation and restoration so that opportunity and a livable planet grow together.",
  },
  {
    icon: "🏠",
    title: "Support for Vulnerable Communities",
    body: "We stand with families navigating hardship — displacement, poverty, crisis — helping to restore the stability that makes learning and a fresh start possible.",
  },
];

export default function OurImpactPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* ---- Intro ---- */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(55% 50% at 50% 0%, color-mix(in srgb, var(--royal) 12%, transparent) 0%, transparent 70%)",
            }}
          />
          <div className="mx-auto w-full max-w-3xl px-5 pt-20 pb-12 text-center sm:px-8 sm:pt-28">
            <span className="rp-rise rp-rise-1 text-gold text-xs font-semibold tracking-[0.2em] uppercase">
              Our Impact
            </span>
            <h1 className="rp-rise rp-rise-2 font-display mt-4 text-5xl font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl">
              Education is where lasting change begins.
            </h1>
            <p className="rp-rise rp-rise-3 text-muted mx-auto mt-6 max-w-2xl text-lg leading-relaxed">
              RoyalPal was built on a simple conviction: that a single lesson can change the course
              of a life — and that a company can be a force for good far beyond its own walls.
            </p>
          </div>
        </section>

        {/* ---- Philosophy / pledge ---- */}
        <section className="mx-auto w-full max-w-3xl px-5 sm:px-8">
          <div className="border-hairline bg-surface shadow-luxe rounded-3xl border p-8 text-center sm:p-12">
            <p className="text-muted-strong text-base leading-relaxed sm:text-lg">
              As RoyalPal grows, we are committed to creating impact beyond the classroom. After all
              legitimate operating expenses, taxes, and business obligations have been fulfilled,{" "}
              <strong className="text-foreground font-semibold">
                we will dedicate 50% of our annual net profits to charitable initiatives
              </strong>{" "}
              — reinvesting our success into the communities and causes that need it most.
            </p>
          </div>
        </section>

        {/* ---- Focus areas ---- */}
        <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <h2 className="font-display text-center text-3xl font-semibold tracking-tight sm:text-4xl">
            Where we focus
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {PILLARS.map((pillar) => (
              <article
                key={pillar.title}
                className="border-hairline bg-surface hover:border-hairline-strong hover:shadow-luxe rounded-2xl border p-7 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-1"
              >
                <span
                  aria-hidden="true"
                  className="inline-grid h-12 w-12 place-items-center rounded-xl bg-[color:var(--hairline)] text-2xl"
                >
                  {pillar.icon}
                </span>
                <h3 className="mt-4 text-xl font-semibold tracking-tight">{pillar.title}</h3>
                <p className="text-muted mt-2 text-sm leading-relaxed sm:text-base">
                  {pillar.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* ---- Statistics (placeholders) ---- */}
        <section className="border-hairline bg-surface/50 border-y">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                Impact we intend to measure
              </h2>
              <p className="text-muted mt-3 text-sm">
                We believe in accountability. As RoyalPal grows, these figures will be reported
                transparently — shown here as the goals we are building toward.
              </p>
            </div>
            <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
              {STATS.map((stat) => (
                <div key={stat.label} className="text-center">
                  <dt className="sr-only">{stat.label}</dt>
                  <dd className="text-royal text-4xl font-semibold tracking-tight sm:text-5xl">
                    {stat.value}
                  </dd>
                  <p aria-hidden="true" className="text-muted mt-2 text-sm font-medium">
                    {stat.label}
                  </p>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ---- Future transparency ---- */}
        <section className="mx-auto w-full max-w-3xl px-5 py-16 text-center sm:px-8 sm:py-24">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Future transparency
          </h2>
          <p className="text-muted mx-auto mt-5 max-w-2xl text-base leading-relaxed sm:text-lg">
            A promise is only as good as the accounting behind it. As our giving begins, we intend
            to publish where contributions go and the difference they make — so that every teacher
            and every learner on RoyalPal knows their work is part of something larger.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href="/signup" size="lg" className="w-full sm:w-auto">
              Join RoyalPal
            </ButtonLink>
            <ButtonLink href="/" variant="secondary" size="lg" className="w-full sm:w-auto">
              Back to home
            </ButtonLink>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
