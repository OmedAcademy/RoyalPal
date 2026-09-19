import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata = {
  title: "Choose a new password · RoyalPal",
  description: "Set a new password for your RoyalPal account.",
};

/**
 * Reached only via /auth/callback?next=/reset-password, which establishes the
 * recovery session first. Rendered without checking for that session on
 * purpose: the form's action reports an expired link in language a person can
 * act on, whereas a redirect from here would look like the link was wrong
 * rather than old.
 */
export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Choose a new password
        </h1>
        <p className="text-muted text-sm">
          Pick something at least 10 characters long that you don&apos;t use anywhere else.
        </p>
      </div>

      <ResetPasswordForm />

      <p className="text-muted text-sm">
        Link expired?{" "}
        <Link
          href="/forgot-password"
          className="text-royal font-medium underline underline-offset-4"
        >
          Request a new one
        </Link>
      </p>
    </div>
  );
}
