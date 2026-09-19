import type { Metadata } from "next";
import { LegalDocument, Section, ReviewFlag } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Privacy Policy — RoyalPal",
  description: "What RoyalPal collects, why, and what you can do about it.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      summary="What we collect, why we collect it, who else can see it, and how to get it removed."
    >
      <Section heading="What we collect">
        <p>
          <strong>When you sign up:</strong> your name, email address and date of birth. The date of
          birth is used to check you are 18 or over and is not shown to anyone else.
        </p>
        <p>
          <strong>Your profile:</strong> whatever you choose to add — a photo, country, time zone,
          languages, and for tutors a biography, rates, qualifications and a video link.
        </p>
        <p>
          <strong>When you use RoyalPal:</strong> your lessons, your messages, your reviews, your
          support requests, and records of payments we processed.
        </p>
        <p>
          <strong>If you use the mobile app:</strong> a push notification token for each device, so
          we can send you lesson reminders. It identifies the device, not you personally, and you
          can remove it by signing out or turning notifications off.
        </p>
      </Section>

      <Section heading="Who can see what">
        <p>
          <strong>Tutors&apos; public profiles</strong> — including name, photo, biography, rates
          and reviews — are visible to anyone browsing RoyalPal once the tutor is approved.
        </p>
        <p>
          <strong>Students&apos; details are not public.</strong> A tutor sees a student&apos;s name
          only through a lesson they have together. Reviews show the reviewer&apos;s first name and
          last initial, never the full surname.
        </p>
        <p>
          <strong>Messages can be read by our team.</strong> This is deliberate and we would rather
          say it plainly than bury it: a report about a message is not something we can investigate
          if nobody is able to read the message. Messages cannot be edited or deleted by either
          party, for the same reason.
        </p>
      </Section>

      <Section heading="Who we share it with">
        <p>
          We use third parties to run the service: Supabase (database, accounts and file storage),
          Vercel (hosting), Resend (email), Stripe (payments), Google (the video calls for lessons),
          and Expo (push notifications). Each receives only what it needs to do its job.
        </p>
        <ReviewFlag>
          Each of these is a processor and needs a data processing agreement. Several store data
          outside the UK/EU, which needs a transfer mechanism and a transfer risk assessment.
        </ReviewFlag>
      </Section>

      <Section heading="How long we keep it">
        <p>
          Your profile and account details are kept while your account exists. When you ask us to
          delete your account we remove your personal details, but we keep the record that a lesson
          took place and that a payment was processed.
        </p>
        <ReviewFlag>
          The specific retention periods — especially for financial records, support threads and
          safeguarding reports — are not set here and must be.
        </ReviewFlag>
      </Section>

      <Section heading="Your rights">
        <p>
          You can see and change most of your information in your profile and settings, and you can
          request deletion from Settings. For anything else, open a support request.
        </p>
        <ReviewFlag>
          Which rights apply, and the deadlines for responding to them, depend on which data
          protection regime covers each user. The product currently offers access, correction and
          erasure; portability is not yet implemented.
        </ReviewFlag>
      </Section>

      <Section heading="Who is responsible">
        <ReviewFlag>
          The identity and contact details of the data controller, and whether a Data Protection
          Officer or a representative is required, are not stated because they have not been
          determined.
        </ReviewFlag>
      </Section>
    </LegalDocument>
  );
}
