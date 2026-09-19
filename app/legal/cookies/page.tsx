import type { Metadata } from "next";
import { LegalDocument, Section, ReviewFlag } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Cookies — RoyalPal",
  description: "The cookies RoyalPal sets and what they do.",
};

export default function CookiesPage() {
  return (
    <LegalDocument
      title="Cookies"
      summary="RoyalPal sets a small number of cookies, and at the time of writing all of them are strictly necessary."
    >
      <Section heading="What we set">
        <p>
          <strong>Session cookies.</strong> Set by Supabase Auth to keep you signed in and to
          refresh your session as you move around the site. Without them you would be signed out on
          every page load. They are removed when you sign out.
        </p>
      </Section>

      <Section heading="What we do not set">
        <p>
          RoyalPal currently runs no analytics, no advertising and no third-party tracking, so there
          are no cookies of that kind to consent to or refuse.
        </p>
      </Section>

      <Section heading="If that changes">
        <p>
          Adding analytics or advertising would mean adding a consent mechanism before those cookies
          are set, not afterwards. This page would be updated at the same time.
        </p>
        <ReviewFlag>
          Whether a consent banner is required today for strictly-necessary cookies alone (generally
          not, but the analysis differs by jurisdiction) should be confirmed rather than assumed by
          the engineering team.
        </ReviewFlag>
      </Section>
    </LegalDocument>
  );
}
