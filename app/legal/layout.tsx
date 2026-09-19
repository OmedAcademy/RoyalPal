import Link from "next/link";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { LEGAL_ROUTES } from "@/lib/constants/legal";

const SECTIONS = [
  { href: LEGAL_ROUTES.terms, label: "Terms of Service" },
  { href: LEGAL_ROUTES.privacy, label: "Privacy Policy" },
  { href: LEGAL_ROUTES.cookies, label: "Cookies" },
  { href: LEGAL_ROUTES.acceptableUse, label: "Acceptable Use" },
  { href: LEGAL_ROUTES.cancellation, label: "Cancellation & Refunds" },
  { href: LEGAL_ROUTES.tutorTerms, label: "Tutor Terms" },
  { href: LEGAL_ROUTES.safeguarding, label: "Safeguarding" },
];

/**
 * Public and unauthenticated on purpose: these documents have to be readable
 * before anyone signs up, and they are linked from the signup form's consent
 * checkbox. They are outside every protected prefix in the middleware.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
          <nav aria-label="Legal documents" className="lg:w-56 lg:shrink-0">
            <ul className="flex flex-wrap gap-1.5 lg:sticky lg:top-24 lg:flex-col">
              {SECTIONS.map((s) => (
                <li key={s.href}>
                  <Link
                    href={s.href}
                    className="text-muted hover:text-foreground block rounded-full px-3 py-1.5 text-sm font-medium transition-colors lg:rounded-lg"
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
