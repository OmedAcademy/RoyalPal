import Link from "next/link";
import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in — RoyalPal",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}) {
  const { redirectTo, error } = await searchParams;

  // Resolved on the server and passed down rather than read with
  // useSearchParams: a client hook here would force the whole page into a
  // Suspense boundary for a value the server already has.
  return (
    <>
      <div className="mb-7">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-muted mt-1.5 text-sm">Sign in to continue to RoyalPal.</p>
      </div>
      {error === "confirmation_failed" && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
        >
          That link has expired or was already used. Sign in, or request a new one.
        </p>
      )}
      <LoginForm redirectTo={redirectTo} />
      <p className="mt-4 text-center text-sm">
        <Link
          href="/forgot-password"
          className="text-muted hover:text-foreground underline underline-offset-4"
        >
          Forgot your password?
        </Link>
      </p>
      <p className="text-muted mt-6 text-center text-sm">
        New to RoyalPal?{" "}
        <Link href="/signup" className="text-royal font-medium hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
