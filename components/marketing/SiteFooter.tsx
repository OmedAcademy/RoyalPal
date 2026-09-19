import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

/**
 * Every policy page, linked from every public page.
 *
 * Not a nicety: the policies are what signup asks people to accept, what the
 * cancellation rules point at when a refund is refused, and what both app
 * stores require a working link to before they will review a build. Before
 * this list existed the pages were live and reachable only by typing the URL.
 */
const LEGAL_LINKS: readonly { href: string; label: string }[] = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/cookies", label: "Cookies" },
  { href: "/legal/acceptable-use", label: "Acceptable Use" },
  { href: "/legal/cancellation", label: "Cancellation & Refunds" },
  { href: "/legal/safeguarding", label: "Safeguarding" },
  { href: "/legal/tutor-terms", label: "Tutor Terms" },
];

export function SiteFooter() {
  return (
    <footer className="border-hairline border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-14 sm:px-8">
        <div className="flex flex-col justify-between gap-10 sm:flex-row sm:items-start">
          <div className="max-w-sm">
            <Logo href="/" />
            <p className="text-muted mt-4 text-sm leading-relaxed">
              Connecting exceptional teachers and learners across the world — and dedicating half of
              our profits to lasting good.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-3 text-sm">
            <span className="text-muted text-xs font-semibold tracking-wider uppercase">
              RoyalPal
            </span>
            <Link href="/our-impact" className="text-foreground hover:text-royal transition-colors">
              Our Impact
            </Link>
            <Link href="/login" className="text-foreground hover:text-royal transition-colors">
              Sign in
            </Link>
            <Link href="/signup" className="text-foreground hover:text-royal transition-colors">
              Create account
            </Link>
          </nav>
          <nav aria-label="Legal" className="flex flex-col gap-3 text-sm">
            <span className="text-muted text-xs font-semibold tracking-wider uppercase">Legal</span>
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-foreground hover:text-royal transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="border-hairline flex items-center justify-between border-t pt-6">
          <p className="text-muted text-xs">
            © {new Date().getFullYear()} RoyalPal. All rights reserved.
          </p>
          <span aria-hidden="true" className="text-gold-soft">
            ✦
          </span>
        </div>
      </div>
    </footer>
  );
}
