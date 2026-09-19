import type { Metadata } from "next";
import { Logo } from "@/components/brand/Logo";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Account suspended — RoyalPal",
  robots: { index: false, follow: false },
};

export default function SuspendedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-5 text-center">
      <Logo href={null} />
      <div className="shadow-luxe border-hairline bg-surface max-w-md rounded-2xl border p-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Account suspended</h1>
        <p className="text-muted mt-3 text-sm leading-relaxed">
          Your RoyalPal account is currently suspended, so access to lessons, bookings, and payments
          is paused. If you believe this is a mistake, open a support request and we&apos;ll review
          it — support is the one area that stays open to a suspended account.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink href="/support">Contact support</ButtonLink>
          <SignOutButton />
        </div>
        <p className="text-muted mt-5 text-xs">
          <Link href="/legal/terms" className="underline underline-offset-2">
            Terms
          </Link>{" "}
          ·{" "}
          <Link href="/legal/acceptable-use" className="underline underline-offset-2">
            Acceptable use
          </Link>
        </p>
      </div>
    </div>
  );
}
