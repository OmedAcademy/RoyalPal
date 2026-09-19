import Link from "next/link";
import type { Metadata } from "next";
import { requireProfile } from "@/lib/supabase/queries";
import { LEGAL_ROUTES } from "@/lib/constants/legal";

export const metadata: Metadata = { title: "Settings — RoyalPal" };

const LINKS = [
  {
    href: "/settings/notifications",
    title: "Notifications",
    description: "Choose what reaches you by email and on your devices.",
  },
  {
    href: "/settings/account",
    title: "Account",
    description: "Your sign-in details, and deleting your account.",
  },
];

export default async function SettingsPage() {
  const profile = await requireProfile(["student", "tutor", "admin"]);
  const profileHref =
    profile.role === "tutor"
      ? "/tutor/profile"
      : profile.role === "student"
        ? "/student/profile"
        : "/admin";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>

      <ul className="border-hairline bg-surface divide-y divide-[color:var(--hairline)] overflow-hidden rounded-2xl border">
        {[
          {
            href: profileHref,
            title: "Profile",
            description: "Your name, photo, and what people see about you.",
          },
          ...LINKS,
        ].map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-[color:var(--hairline)]/40"
            >
              <span className="min-w-0">
                <span className="block font-medium">{link.title}</span>
                <span className="text-muted block text-sm">{link.description}</span>
              </span>
              <span aria-hidden="true" className="text-muted shrink-0">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Policies</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {[
            [LEGAL_ROUTES.terms, "Terms"],
            [LEGAL_ROUTES.privacy, "Privacy"],
            [LEGAL_ROUTES.cookies, "Cookies"],
            [LEGAL_ROUTES.acceptableUse, "Acceptable use"],
            [LEGAL_ROUTES.cancellation, "Cancellation & refunds"],
            [LEGAL_ROUTES.safeguarding, "Safeguarding"],
            ...(profile.role === "tutor"
              ? ([[LEGAL_ROUTES.tutorTerms, "Tutor terms"]] as const)
              : []),
          ].map(([href, label]) => (
            <li key={href}>
              <Link
                href={href}
                className="text-muted hover:text-foreground underline underline-offset-4"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
