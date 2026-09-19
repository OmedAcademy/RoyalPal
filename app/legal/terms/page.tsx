import type { Metadata } from "next";
import { LegalDocument, Section, ReviewFlag } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Terms of Service — RoyalPal",
  description: "The terms that govern using RoyalPal.",
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      summary="What RoyalPal is, what we do, and what we expect from the people who use it."
    >
      <Section heading="1. What RoyalPal is">
        <p>
          RoyalPal is a marketplace. We connect students with independent tutors, take payment for
          lessons, and pass the tutor&apos;s share on to them. We are not the tutor, we do not
          employ tutors, and we do not deliver the lessons ourselves.
        </p>
        <ReviewFlag>
          Whether RoyalPal acts as agent or principal, and how tutors are classified, determines tax
          treatment, consumer-law duties and liability. This paragraph states the intended position;
          it needs confirming for every jurisdiction served.
        </ReviewFlag>
      </Section>

      <Section heading="2. Who may use RoyalPal">
        <p>
          You must be 18 or over. We ask for your date of birth at signup and refuse accounts below
          that age. You must give accurate information, keep your password to yourself, and tell us
          if you think someone else has got into your account.
        </p>
        <ReviewFlag>
          The 18+ restriction is an engineering default chosen because serving minors carries
          safeguarding and consent duties we have not been advised on. If RoyalPal intends to serve
          under-18s, this clause and the entire safeguarding position change.
        </ReviewFlag>
      </Section>

      <Section heading="3. Booking and paying for lessons">
        <p>
          Prices are set by each tutor and shown before you book. Payment is taken when you book;
          the lesson slot is held for you from that moment. RoyalPal charges the tutor a commission
          on each lesson, which is deducted from their share and does not change what you pay.
        </p>
        <p>
          A booking is confirmed only once payment has succeeded. Until then the slot is reserved
          but not guaranteed, and an unpaid booking is released automatically.
        </p>
      </Section>

      <Section heading="4. Cancellations and refunds">
        <p>
          Cancellation windows and refund eligibility are set out in the Cancellation &amp; Refunds
          policy, which forms part of these terms.
        </p>
        <ReviewFlag>
          Consumer distance-selling rules in the UK and EU may grant a statutory cancellation right
          that overrides whatever commercial policy is chosen. That interaction must be resolved
          before the policy is published as binding.
        </ReviewFlag>
      </Section>

      <Section heading="5. Conduct">
        <p>
          The Acceptable Use policy sets out what is not allowed. Breaking it can lead to a warning,
          suspension, or removal from RoyalPal. A suspended account keeps access to support so the
          decision can be appealed.
        </p>
      </Section>

      <Section heading="6. Content you provide">
        <p>
          You keep ownership of what you write — your profile, your messages, your reviews. You give
          us permission to store and display it as needed to run the service. Reviews cannot be
          edited once submitted; they can be hidden by us if they break the Acceptable Use policy,
          and a tutor may reply to a review about them once.
        </p>
      </Section>

      <Section heading="7. Availability">
        <p>
          We work to keep RoyalPal running but do not promise it will be uninterrupted. Lessons are
          delivered over a third-party video service and we are not responsible for that
          provider&apos;s outages.
        </p>
      </Section>

      <Section heading="8. Liability">
        <ReviewFlag>
          Deliberately left unwritten. Limitation and exclusion of liability is the clause most
          likely to be unenforceable if drafted by a non-lawyer, and getting it wrong is worse than
          having no clause at all. It must be drafted, not adapted.
        </ReviewFlag>
      </Section>

      <Section heading="9. Ending your account">
        <p>
          You can ask us to delete your account at any time from Settings. Deletion is scheduled
          rather than immediate, and we email you when it is requested so that someone who has got
          into your account cannot use deletion to cover their tracks. Some records — lessons that
          took place and payments we processed — are kept after your personal details are removed.
        </p>
        <ReviewFlag>
          Retention periods for financial records, and the balance between erasure rights and
          record-keeping duties, need setting by a lawyer and an accountant together.
        </ReviewFlag>
      </Section>

      <Section heading="10. Changes">
        <p>
          We will publish a new version here if these terms change, and record which version you
          accepted when you signed up.
        </p>
        <ReviewFlag>
          Whether existing users must actively re-accept a materially changed version, or whether
          notice is sufficient, is a legal question.
        </ReviewFlag>
      </Section>

      <Section heading="11. Governing law">
        <ReviewFlag>
          Not stated, because it depends on where RoyalPal is established and where its users are.
          This is one of the first things to settle.
        </ReviewFlag>
      </Section>
    </LegalDocument>
  );
}
