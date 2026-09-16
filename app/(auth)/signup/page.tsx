import Link from "next/link";
import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/SignupForm";

export const metadata: Metadata = {
  title: "Create your account — RoyalPal",
};

export default function SignupPage() {
  return (
    <>
      <div className="mb-7">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-muted mt-1.5 text-sm">Start teaching or learning on RoyalPal.</p>
      </div>
      <SignupForm />
      <p className="text-muted mt-6 text-center text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-royal font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
