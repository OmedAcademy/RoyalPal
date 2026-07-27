import type { NotificationType } from "@/lib/notifications/types";

/**
 * Email templates. Each returns a subject + HTML + plaintext built from the
 * already-composed notification title/body, so the wording lives in one
 * place (the service) and email simply presents it in a branded shell.
 * Types without a template fall back to a generic branded email.
 */
export type EmailContent = { subject: string; html: string; text: string };

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://royalpal.app";

function shell(heading: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f8f5ee;font-family:Georgia,serif;color:#12233d">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fffdf8;border:1px solid rgba(15,45,82,0.12);border-radius:16px;overflow:hidden">
          <tr><td style="height:3px;background:linear-gradient(90deg,transparent,#d4af37,transparent)"></td></tr>
          <tr><td style="padding:32px">
            <p style="margin:0 0 8px;font-size:20px;font-weight:600">Royal<span style="color:#0f2d52">Pal</span></p>
            <h1 style="margin:16px 0 12px;font-size:22px;color:#0f2d52">${heading}</h1>
            <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#3a4456">${bodyHtml}</div>
            <p style="margin:28px 0 0"><a href="${APP_URL}" style="color:#0f2d52;font-family:Arial,sans-serif;font-size:14px">Open RoyalPal →</a></p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#8891a3">Teach Without Borders. Learn Without Limits.</p>
      </td></tr>
    </table>
  </body></html>`;
}

function generic(title: string, body: string | undefined): EmailContent {
  const text = body ? `${title}\n\n${body}` : title;
  return { subject: title, html: shell(title, `<p style="margin:0">${body ?? ""}</p>`), text };
}

/** Type-specific templates; anything not listed uses the generic shell. */
const TEMPLATES: Partial<Record<NotificationType, (title: string, body?: string) => EmailContent>> =
  {
    booking_confirmed: (title, body) => ({
      subject: "Your lesson is confirmed",
      html: shell("Your lesson is confirmed", `<p style="margin:0">${body ?? title}</p>`),
      text: `${title}\n\n${body ?? ""}`,
    }),
    booking_cancelled: (title, body) => ({
      subject: "A lesson was cancelled",
      html: shell("A lesson was cancelled", `<p style="margin:0">${body ?? title}</p>`),
      text: `${title}\n\n${body ?? ""}`,
    }),
    tutor_approved: (title, body) => ({
      subject: "Welcome — you're an approved RoyalPal tutor",
      html: shell("You're approved 🎓", `<p style="margin:0">${body ?? title}</p>`),
      text: `${title}\n\n${body ?? ""}`,
    }),
    payment_succeeded: (title, body) => ({
      subject: "Payment receipt — RoyalPal",
      html: shell("Payment received", `<p style="margin:0">${body ?? title}</p>`),
      text: `${title}\n\n${body ?? ""}`,
    }),
  };

export function renderEmail(type: string, title: string, body?: string): EmailContent {
  const builder = TEMPLATES[type as NotificationType];
  return builder ? builder(title, body) : generic(title, body);
}
