import Link from "next/link";
import {
  payoutBannerFor,
  type ConnectAccountState,
  type PayoutBanner,
} from "@/lib/stripe/account-status";

/**
 * Surfaces payout problems where a tutor actually looks — the dashboard —
 * rather than only on /tutor/payouts, which they have no reason to open
 * unless they already suspect something is wrong. Without this, a restricted
 * account presents as "my bookings stopped converting" with no explanation.
 *
 * Deliberately holds NO branching logic: which banner to show is decided by
 * payoutBannerFor() in lib/stripe/account-status, shared with the payouts
 * page and unit tested there. This component only maps a variant to copy.
 *
 * Reads mirrored database state only — no Stripe call — so it renders fine
 * with no credentials configured.
 */

const TONE = {
  urgent:
    "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  warn: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  info: "border-hairline bg-surface text-muted",
} as const;

const COPY: Record<PayoutBanner, { tone: keyof typeof TONE; body: string; cta: string }> = {
  restricted: {
    tone: "urgent",
    body: "Stripe needs more information before you can be paid.",
    cta: "Resolve it now",
  },
  not_connected: {
    tone: "warn",
    body: "You haven't connected a payout account yet, so you can't receive earnings from paid lessons.",
    cta: "Connect Stripe",
  },
  incomplete: {
    tone: "warn",
    body: "Your payout account isn't active yet — students can't book paid lessons with you until it is.",
    cta: "Finish setup",
  },
  verifying: {
    tone: "info",
    body: "Stripe is reviewing your payout details. No action is needed from you right now.",
    cta: "Check status",
  },
  payouts_paused: {
    tone: "warn",
    body: "You're earning normally, but bank payouts are paused on your Stripe account, so earnings are collecting there instead.",
    cta: "View details",
  },
};

export function PayoutStatusBanner({
  stripeConfigured,
  account,
}: {
  stripeConfigured: boolean;
  account: ConnectAccountState | null | undefined;
}) {
  const variant = payoutBannerFor(stripeConfigured, account);
  if (!variant) return null;

  const { tone, body, cta } = COPY[variant];

  return (
    <p role="status" className={`rounded-lg border px-4 py-3 text-sm ${TONE[tone]}`}>
      {body}{" "}
      <Link href="/tutor/payouts" className="font-medium underline underline-offset-2">
        {cta}
      </Link>
      .
    </p>
  );
}
