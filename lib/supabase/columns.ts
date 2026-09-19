/**
 * The columns an RLS-scoped client may read from profiles and tutor_profiles.
 *
 * Migration 0041 revokes SELECT on the rest from `authenticated`, because Row
 * Level Security filters rows and cannot scope columns — so a policy written
 * to share a tutor's name was also sharing their date of birth.
 *
 * These lists exist so the boundary is stated once. A query that asks for a
 * withheld column does not return null; PostgreSQL refuses the whole statement
 * with "permission denied for column", which is why `select("*")` cannot be
 * used against either table through a client.
 *
 * Privileged code that genuinely needs the withheld columns uses the service
 * role, which bypasses both RLS and column privileges. Every such caller is
 * scoped by an id the request has already been authorized for.
 */

/** Everything on `profiles` except `phone` and `date_of_birth`. */
export const PROFILE_CLIENT_COLUMNS =
  "id, role, full_name, avatar_url, country, timezone, status, created_at, updated_at, age_confirmed_at, terms_accepted_at, terms_version, deletion_requested_at, anonymized_at";

/**
 * Everything on `tutor_profiles` except the tutor's Stripe and commission
 * state: stripe_account_id, stripe_payouts_enabled, stripe_details_submitted,
 * stripe_requirements_due, stripe_disabled_reason and platform_fee_bps.
 *
 * `stripe_charges_enabled` is deliberately included — search needs it to say
 * whether a tutor can accept a paid booking, and it reveals nothing about the
 * account behind it.
 */
export const TUTOR_PROFILE_CLIENT_COLUMNS =
  "id, headline, bio, video_url, hourly_rate_cents, trial_price_cents, currency, languages_spoken, teaching_languages, specializations, years_experience, certifications, education, availability_note, verification_status, avg_rating, total_reviews, stripe_charges_enabled, rejection_reason, rejection_notes, verification_decided_at, verification_decided_by, created_at, updated_at";
