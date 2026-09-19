import type { NotificationType } from "@/lib/notifications/types";

/**
 * Email templates. Each returns a subject + HTML + plaintext built from the
 * already-composed notification title/body, so the wording lives in one place
 * (the service) and email simply presents it in a branded shell. Types
 * without a template fall back to a generic branded email.
 */
export type EmailContent = { subject: string; html: string; text: string };

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://royalpal.app";

/**
 * Escapes text before it is interpolated into the HTML body.
 *
 * This is not hypothetical hygiene. Notification titles and bodies carry user
 * content — a review comment, a cancellation reason, and now a message
 * preview, which is free text one person types and another receives. Before
 * this, every one of those was concatenated straight into the markup.
 *
 * Mail clients are not browsers and most strip <script>, so the realistic
 * outcome was a broken layout or a smuggled link rather than script
 * execution — but "most clients" is not a security boundary, and an <a href>
 * injected into an email that genuinely came from us is a very good phishing
 * primitive. Escaping is one function call and removes the whole class.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Builds the call-to-action URL. Only an app-relative path is accepted: the
 * href comes from a notification payload, and an absolute URL there would let
 * whatever wrote that payload send a RoyalPal-branded email pointing anywhere.
 */
function ctaUrl(href?: string): string {
  if (!href || !href.startsWith("/") || href.startsWith("//") || href.includes("\\")) {
    return APP_URL;
  }
  return `${APP_URL}${href}`;
}

function shell(
  heading: string,
  bodyHtml: string,
  href?: string,
  ctaLabel = "Open RoyalPal",
): string {
  return `<!doctype html><html><body style="margin:0;background:#f8f5ee;font-family:Georgia,serif;color:#12233d">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fffdf8;border:1px solid rgba(15,45,82,0.12);border-radius:16px;overflow:hidden">
          <tr><td style="height:3px;background:linear-gradient(90deg,transparent,#d4af37,transparent)"></td></tr>
          <tr><td style="padding:32px">
            <p style="margin:0 0 8px;font-size:20px;font-weight:600">Royal<span style="color:#0f2d52">Pal</span></p>
            <h1 style="margin:16px 0 12px;font-size:22px;color:#0f2d52">${escapeHtml(heading)}</h1>
            <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#3a4456">${bodyHtml}</div>
            <p style="margin:28px 0 0"><a href="${ctaUrl(href)}" style="display:inline-block;background:#0f2d52;color:#fffdf8;text-decoration:none;padding:11px 20px;border-radius:999px;font-family:Arial,sans-serif;font-size:14px">${escapeHtml(ctaLabel)} →</a></p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#8891a3">Teach Without Borders. Learn Without Limits.</p>
        <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#8891a3"><a href="${APP_URL}/settings/notifications" style="color:#8891a3">Manage email preferences</a></p>
      </td></tr>
    </table>
  </body></html>`;
}

function paragraph(body: string | undefined): string {
  return `<p style="margin:0">${escapeHtml(body ?? "")}</p>`;
}

function plain(title: string, body: string | undefined, href?: string): string {
  return [title, body, `\n${ctaUrl(href)}`].filter(Boolean).join("\n\n");
}

type Builder = (title: string, body?: string, href?: string) => EmailContent;

function template(subject: string, heading: string, ctaLabel: string): Builder {
  return (title, body, href) => ({
    subject,
    html: shell(heading, paragraph(body ?? title), href, ctaLabel),
    text: plain(title, body, href),
  });
}

/** Type-specific templates; anything not listed uses the generic shell. */
const TEMPLATES: Partial<Record<NotificationType, Builder>> = {
  booking_created: template(
    "Your lesson is booked — RoyalPal",
    "Your lesson is booked",
    "View lesson",
  ),
  booking_confirmed: template(
    "Your lesson is confirmed — RoyalPal",
    "Your lesson is confirmed",
    "View lesson",
  ),
  booking_cancelled: template(
    "A lesson was cancelled — RoyalPal",
    "A lesson was cancelled",
    "View lessons",
  ),
  booking_rescheduled: template(
    "A lesson was moved — RoyalPal",
    "A lesson was moved",
    "View lesson",
  ),
  lesson_reminder: template(
    "Your lesson starts soon — RoyalPal",
    "Your lesson starts soon",
    "Join lesson",
  ),
  message_received: template("New message — RoyalPal", "You have a new message", "Read and reply"),
  tutor_approved: template(
    "Welcome — you're an approved RoyalPal tutor",
    "You're approved 🎓",
    "Go to dashboard",
  ),
  tutor_rejected: template(
    "About your RoyalPal tutor application",
    "Your application needs changes",
    "Update profile",
  ),
  payment_succeeded: template("Payment receipt — RoyalPal", "Payment received", "View lesson"),
  payment_failed: template(
    "Payment problem — RoyalPal",
    "We couldn't take that payment",
    "Try again",
  ),
  payment_refunded: template(
    "Refund issued — RoyalPal",
    "Your refund is on its way",
    "View lesson",
  ),
  review_received: template(
    "You received a review — RoyalPal",
    "You received a review",
    "See review",
  ),
  review_replied: template(
    "A tutor replied to your review — RoyalPal",
    "A reply to your review",
    "See reply",
  ),
  support_reply: template("Support replied — RoyalPal", "Support has replied", "Open ticket"),
  account_deletion_requested: template(
    "Your RoyalPal account is scheduled for deletion",
    "Account deletion scheduled",
    "Cancel deletion",
  ),
  account_deletion_cancelled: template(
    "Your RoyalPal account deletion was cancelled",
    "Account deletion cancelled",
    "Open RoyalPal",
  ),
};

function generic(title: string, body: string | undefined, href?: string): EmailContent {
  return {
    subject: title,
    html: shell(title, paragraph(body), href),
    text: plain(title, body, href),
  };
}

export function renderEmail(
  type: string,
  title: string,
  body?: string,
  href?: string,
): EmailContent {
  const builder = TEMPLATES[type as NotificationType];
  return builder ? builder(title, body, href) : generic(title, body, href);
}
