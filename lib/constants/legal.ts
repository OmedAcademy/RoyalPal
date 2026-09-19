/**
 * The version of the published legal documents currently in force.
 *
 * Stamped onto profiles.terms_version at signup so "this user accepted the
 * terms" can be resolved to a specific text later. Bump it whenever Terms,
 * Privacy or Acceptable Use change materially — and note that bumping it is
 * only half the job: existing users have consented to the OLD version, and
 * whether they must be re-prompted is a legal question, not a product one.
 *
 * >>> REQUIRES LEGAL REVIEW <<<
 */
export const LEGAL_VERSION = "2026-09-19";

/** Where the published documents live, in one place so links cannot drift. */
export const LEGAL_ROUTES = {
  terms: "/legal/terms",
  privacy: "/legal/privacy",
  cookies: "/legal/cookies",
  acceptableUse: "/legal/acceptable-use",
  cancellation: "/legal/cancellation",
  tutorTerms: "/legal/tutor-terms",
  safeguarding: "/legal/safeguarding",
} as const;
