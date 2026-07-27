import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";

/**
 * Public marketing header. A restrained glass bar: translucent ivory with a
 * platinum hairline, so content scrolls beneath it without visual noise.
 */
export function SiteHeader() {
  return (
    <header className="border-hairline sticky top-0 z-40 border-b bg-[color:var(--background)]/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-1.5 sm:gap-3">
          <Link
            href="/our-impact"
            className="text-muted hover:text-foreground hidden rounded-full px-3 py-2 text-sm font-medium transition-colors sm:inline-flex"
          >
            Our Impact
          </Link>
          <Link
            href="/login"
            className="text-foreground hover:text-royal rounded-full px-3 py-2 text-sm font-medium transition-colors"
          >
            Sign in
          </Link>
          <ButtonLink href="/signup" size="md">
            Create account
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}
