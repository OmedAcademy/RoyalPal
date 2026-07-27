import Link from "next/link";
import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in — RoyalPal",
};

export default function LoginPage() {
  return (
    <>
      <div className="mb-7">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-muted mt-1.5 text-sm">Sign in to continue to RoyalPal.</p>
      </div>
      <LoginForm />
      <p className="text-muted mt-6 text-center text-sm">
        New to RoyalPal?{" "}
        <Link href="/signup" className="text-royal font-medium hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
