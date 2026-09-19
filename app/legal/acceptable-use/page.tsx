import type { Metadata } from "next";
import { LegalDocument, Section } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Acceptable Use — RoyalPal",
  description: "What is and isn't allowed on RoyalPal.",
};

export default function AcceptableUsePage() {
  return (
    <LegalDocument
      title="Acceptable Use"
      summary="The short version: treat people well, keep lessons on RoyalPal, and don't use the platform to harm anyone."
    >
      <Section heading="Don't">
        <ul className="list-disc pl-5">
          <li>Harass, threaten, demean or discriminate against anyone.</li>
          <li>Send sexual content, or contact anyone in a sexual way.</li>
          <li>Pretend to be someone else, or misrepresent your qualifications.</li>
          <li>Post someone else&apos;s personal information.</li>
          <li>Use RoyalPal to advertise, recruit, or sell something unrelated to lessons.</li>
          <li>Try to move payment off RoyalPal to avoid commission — see below.</li>
          <li>Attempt to break, probe or overload the service.</li>
        </ul>
      </Section>

      <Section heading="Keep lessons on RoyalPal">
        <p>
          Arranging and paying for lessons through RoyalPal is what makes the protections work:
          payments are traceable, cancellations follow a policy, and if something goes wrong there
          is a record. A lesson arranged privately has none of that, for either side.
        </p>
      </Section>

      <Section heading="Messages">
        <p>
          Conversations are attached to a lesson and are kept. Our team can read them when
          investigating a report, and neither party can edit or delete a message after sending it.
          That is what makes a report actionable, and it is why we say so before you write anything
          rather than afterwards.
        </p>
      </Section>

      <Section heading="Reviews">
        <p>
          Review the lesson you had. Reviews cannot be edited once submitted. We can hide one that
          breaks this policy — hiding keeps the record but removes it from public view and from the
          tutor&apos;s rating. A tutor may reply once to a review about them.
        </p>
      </Section>

      <Section heading="What happens if you break this">
        <p>
          Depending on what happened: a warning, hiding the content, suspending the account, or
          removing it. Suspension leaves support open so you can appeal. Anything that suggests
          someone is at risk is treated as urgent — see our Safeguarding policy.
        </p>
      </Section>

      <Section heading="Reporting">
        <p>
          Open a support request and choose &quot;Report a person&quot; or &quot;Safety
          concern&quot;. Those categories are separated from the ordinary support queue and looked
          at first.
        </p>
      </Section>
    </LegalDocument>
  );
}
