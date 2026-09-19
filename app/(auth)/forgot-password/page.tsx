import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata = {
  title: "Reset your password · RoyalPal",
  description: "Request a link to set a new RoyalPal password.",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Reset your password
        </h1>
        <p className="text-muted text-sm">
          Enter the email address you signed up with and we&apos;ll send you a link to set a new
          password.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="text-muted text-sm">
        Remembered it?{" "}
        <Link href="/login" className="text-royal font-medium underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
