import type { ReactNode } from "react";
import { LEGAL_VERSION } from "@/lib/constants/legal";

/**
 * The shell every legal page renders in — and, more importantly, the banner
 * every one of them carries.
 *
 * The content in these documents was drafted by an engineer to describe what
 * the software actually does. That is genuinely useful to a lawyer (it is the
 * factual basis they would otherwise have to extract by interview) and it is
 * NOT a substitute for one. The banner is not boilerplate: shipping these as
 * finished terms would be presenting unreviewed text as a binding agreement,
 * and the person who would carry that risk is the operator, not the author.
 */
export function LegalDocument({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="text-muted text-sm leading-relaxed">{summary}</p>
        <p className="text-muted text-xs">Version {LEGAL_VERSION}</p>
      </header>

      <div
        role="note"
        className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm leading-relaxed text-amber-800 dark:text-amber-300"
      >
        <strong className="font-semibold">Awaiting legal review.</strong> This document describes
        how RoyalPal actually works and is drafted as a factual starting point for a qualified
        lawyer. It has not been reviewed by one, it is not legal advice, and it should not be relied
        on as a binding agreement until it has been reviewed and adopted for the jurisdictions
        RoyalPal operates in.
      </div>

      <div className="flex flex-col gap-5 text-sm leading-relaxed">{children}</div>
    </article>
  );
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold tracking-tight">{heading}</h2>
      {children}
    </section>
  );
}

export function ReviewFlag({ children }: { children: ReactNode }) {
  return (
    <p className="border-hairline-strong text-muted border-l-2 pl-3 text-xs italic">
      <strong className="not-italic">For legal review:</strong> {children}
    </p>
  );
}
