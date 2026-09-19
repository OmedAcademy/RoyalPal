import type { Metadata } from "next";
import { LegalDocument, Section, ReviewFlag } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Safeguarding — RoyalPal",
  description: "How RoyalPal approaches safety, and the age restriction that follows from it.",
};

export default function SafeguardingPage() {
  return (
    <LegalDocument
      title="Safeguarding"
      summary="RoyalPal is for adults. This page explains that decision, what we do to keep people safe, and what we have deliberately not claimed."
    >
      <Section heading="RoyalPal is 18+">
        <p>
          You must be 18 or over to have a RoyalPal account. We ask for your date of birth when you
          sign up and refuse accounts below that age. This is checked when the account is created,
          not merely asked on a form.
        </p>
        <p>
          We do not currently verify age beyond what you tell us. If we find an account belongs to
          someone under 18 we will close it.
        </p>
        <ReviewFlag>
          This restriction was chosen because serving minors brings duties — background screening,
          guardian consent, contact monitoring, reporting obligations, record retention — that
          differ by jurisdiction and that we have not been advised on. Opening RoyalPal to under-18s
          is not a settings change; it is a programme of work that starts with legal advice.
        </ReviewFlag>
      </Section>

      <Section heading="What we do">
        <ul className="list-disc pl-5">
          <li>
            Tutors are reviewed by a person before their profile becomes visible or bookable. A
            tutor cannot publish themselves.
          </li>
          <li>
            There is no open messaging. A conversation exists only where a lesson has been booked,
            so nobody can contact a stranger out of the blue.
          </li>
          <li>
            Messages are retained and readable by our team when a report is made, and cannot be
            edited or deleted by either party.
          </li>
          <li>
            Reports categorised as a safety concern are separated from the ordinary support queue.
          </li>
          <li>Accounts can be suspended immediately, which cuts off every area except support.</li>
        </ul>
      </Section>

      <Section heading="What we do not claim">
        <p>
          We do not run criminal record or background checks on tutors. We do not monitor lessons.
          Verification confirms that a profile was reviewed by a person — it is not a vetting
          certificate, and we do not describe it as one.
        </p>
      </Section>

      <Section heading="If someone is at risk">
        <p>
          RoyalPal support is not an emergency service. If someone is in immediate danger, contact
          your local emergency services first. Then open a support request marked &quot;Safety
          concern&quot; so we have a record and can act on our side.
        </p>
        <ReviewFlag>
          Whether RoyalPal has a duty to report certain disclosures to an authority — and to which
          one — is jurisdiction-specific and unresolved. Until it is, the operational commitment on
          this page is limited to what the software actually does.
        </ReviewFlag>
      </Section>
    </LegalDocument>
  );
}
