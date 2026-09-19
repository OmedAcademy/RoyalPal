import type { Metadata } from "next";
import { LegalDocument, Section, ReviewFlag } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Tutor Terms — RoyalPal",
  description: "The additional terms that apply if you teach on RoyalPal.",
};

export default function TutorTermsPage() {
  return (
    <LegalDocument
      title="Tutor Terms"
      summary="Additional terms for tutors, on top of the main Terms of Service."
    >
      <Section heading="You are independent">
        <p>
          Tutors on RoyalPal are independent. You decide your rates, your subjects, your
          availability and how you teach. RoyalPal does not employ you, does not direct your
          lessons, and does not guarantee you any volume of work.
        </p>
        <ReviewFlag>
          Employment status is determined by the actual relationship, not by what a document calls
          it. The degree of control RoyalPal exercises — approval, pricing constraints, cancellation
          rules — should be reviewed against the tests that apply in each jurisdiction.
        </ReviewFlag>
      </Section>

      <Section heading="Verification">
        <p>
          A person reviews your profile before it becomes visible. We may approve it, or reject it
          with a reason so you know what to change. Approval can be withdrawn if your profile stops
          meeting our standards or you break the Acceptable Use policy.
        </p>
      </Section>

      <Section heading="Pricing and commission">
        <p>
          You set your hourly rate and your optional trial-lesson price. RoyalPal takes a commission
          on each lesson, deducted from your share. The rate that applies to a lesson is fixed when
          that lesson is booked, so a later change never affects a lesson already agreed.
        </p>
      </Section>

      <Section heading="Getting paid">
        <p>
          Payouts run through Stripe, and you complete Stripe&apos;s own onboarding before you can
          be paid. Until that is finished you can still offer trial lessons but not standard ones.
        </p>
        <ReviewFlag>
          Payout timing, what happens to funds for a disputed lesson, and who absorbs the cost of a
          lost dispute are commercial decisions that are not yet made. They belong here once they
          are.
        </ReviewFlag>
      </Section>

      <Section heading="Your tax">
        <p>
          You are responsible for your own tax and for any registration your local rules require.
          RoyalPal does not withhold tax on your behalf.
        </p>
        <ReviewFlag>
          Platform reporting duties (for example DAC7 in the EU) may require RoyalPal to collect and
          report tutor earnings data. This needs checking before tutors are onboarded at scale.
        </ReviewFlag>
      </Section>

      <Section heading="Cancelling on a student">
        <p>
          Cancelling a confirmed lesson affects a student who has already paid and arranged their
          time. Repeated cancellations may lead to review of your account.
        </p>
      </Section>
    </LegalDocument>
  );
}
