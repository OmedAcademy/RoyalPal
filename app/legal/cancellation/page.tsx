import type { Metadata } from "next";
import { LegalDocument, Section, ReviewFlag } from "@/components/legal/LegalDocument";
import { FREE_CANCELLATION_HOURS } from "@/lib/booking/cancellation-policy";

export const metadata: Metadata = {
  title: "Cancellation & Refunds — RoyalPal",
  description: "When a cancelled lesson is refunded, and when it isn't.",
};

/**
 * The window is imported from the policy module rather than typed out, so this
 * page cannot describe a rule the code does not implement. If the number
 * changes in one place it changes here too.
 */
export default function CancellationPage() {
  return (
    <LegalDocument
      title="Cancellation & Refunds"
      summary={`The short version: cancel more than ${FREE_CANCELLATION_HOURS} hours before a lesson and you get your money back; inside that window you don't, because your tutor kept the time free.`}
    >
      <Section heading="If you are a student">
        <p>
          <strong>Before you have paid.</strong> Nothing has been taken, so there is nothing to
          refund. The slot is released for someone else.
        </p>
        <p>
          <strong>More than {FREE_CANCELLATION_HOURS} hours before the lesson.</strong> Cancel for a
          full refund. We ask Stripe to return the payment as soon as you cancel; it usually reaches
          your account within a few working days.
        </p>
        <p>
          <strong>Within {FREE_CANCELLATION_HOURS} hours of the lesson.</strong> No refund. Your
          tutor has held that time and turned other work away, and at that notice they cannot
          realistically fill it.
        </p>
        <p>
          <strong>After the lesson has started.</strong> Treated the same as cancelling inside the
          window.
        </p>
      </Section>

      <Section heading="If you are a tutor">
        <p>
          Cancelling a confirmed lesson refunds your student in full, at any notice. The window
          above exists to protect your reserved time from a late change of mind — it is not there to
          protect you from your own, and applying it to you would make it do exactly that.
        </p>
        <p>Repeatedly cancelling on students may lead to a review of your account.</p>
      </Section>

      <Section heading="If RoyalPal cancels">
        <p>Refunded in full, whatever the reason and whatever the notice.</p>
      </Section>

      <Section heading="Rescheduling instead">
        <p>
          Moving a lesson is not a cancellation and no money changes hands. Either of you can
          propose a new time while the lesson is still upcoming, and a lesson can be moved a limited
          number of times before it has to be cancelled and rebooked.
        </p>
      </Section>

      <Section heading="What we say about a refund, and when">
        <p>
          We tell you a refund is <em>on its way</em> when we have asked the payment provider for
          it, and that is all we know at that moment. We never tell you money has been returned
          until the payment provider confirms it has. If we could not ask — for example because
          payments were temporarily unavailable — we say so and our team follows it up rather than
          letting it disappear.
        </p>
      </Section>

      <Section heading="Disputes">
        <p>
          If something went wrong that this policy does not cover, open a support request before
          raising a dispute with your bank. We would rather fix it directly.
        </p>
      </Section>

      <ReviewFlag>
        Consumer distance-selling rules in the UK and EU may grant a statutory right to cancel that
        overrides the commercial window described here, and there are exceptions for services that
        begin during the cancellation period. The {FREE_CANCELLATION_HOURS}-hour window is a
        commercial choice, not a researched legal position, and the interaction between the two must
        be resolved before this policy is presented as binding.
      </ReviewFlag>
    </LegalDocument>
  );
}
