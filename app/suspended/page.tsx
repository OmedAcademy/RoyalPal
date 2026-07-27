import type { Metadata } from "next";
import { Logo } from "@/components/brand/Logo";
import { SignOutButton } from "@/components/auth/SignOutButton";

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
          is paused. If you believe this is a mistake, please contact support and we&apos;ll review
          it.
        </p>
        <div className="mt-6 flex justify-center">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
