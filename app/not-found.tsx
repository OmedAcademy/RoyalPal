import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-5 text-center">
      <Logo />
      <div>
        <p className="font-display text-royal text-6xl font-semibold tracking-tight">404</p>
        <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-muted mt-3 max-w-sm text-sm leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
      </div>
      <Link
        href="/"
        className="bg-royal text-royal-contrast shadow-luxe inline-flex h-11 items-center rounded-full px-5 text-sm font-medium transition-transform hover:-translate-y-0.5"
      >
        Back to home
      </Link>
    </div>
  );
}
