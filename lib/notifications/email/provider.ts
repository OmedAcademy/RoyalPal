import "server-only";

/**
 * Transport-agnostic email contract. Swapping Resend for SES/Postmark later
 * means implementing this interface once — no business logic changes.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export interface EmailProvider {
  readonly name: string;
  /** True only when credentials are configured. The notification service
   * checks this before attempting delivery, so email stays fully dormant
   * until keys are added — no code change required to switch it on. */
  isEnabled(): boolean;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Resend implementation. Wired and ready; dormant until RESEND_API_KEY and
 * EMAIL_FROM_ADDRESS are set. Uses the REST API directly (no SDK dependency).
 */
class ResendProvider implements EmailProvider {
  readonly name = "resend";

  isEnabled(): boolean {
    return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM_ADDRESS);
  }

  async send(message: EmailMessage): Promise<void> {
    if (!this.isEnabled()) return;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM_ADDRESS,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!res.ok) {
      throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
    }
  }
}

let provider: EmailProvider | null = null;

/** The configured email provider (singleton). */
export function getEmailProvider(): EmailProvider {
  if (!provider) provider = new ResendProvider();
  return provider;
}
