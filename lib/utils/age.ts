/**
 * Age in whole years on a given day.
 *
 * Calendar arithmetic, not milliseconds: dividing an interval by 365.25 gets
 * the answer wrong for anyone whose birthday is near the boundary in a leap
 * year, and "wrong near the boundary" is the entire population this function
 * exists to judge.
 *
 * Both dates are read in UTC. A birth date is a calendar fact with no time
 * zone, and reading it in the server's local zone would make someone's age
 * depend on which region the request happened to be served from.
 */
export function ageOn(dateOfBirth: string, on: Date = new Date()): number {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return Number.NaN;

  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = on.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/**
 * The minimum age RoyalPal accepts.
 *
 * >>> REQUIRES LEGAL REVIEW <<<
 * 18 is the restrictive default chosen in migration 0036, not a researched
 * legal position. Whether RoyalPal may serve minors — and under what
 * safeguarding, consent and screening regime — is a question for a lawyer.
 * Lowering this number is not a configuration change; it is the entry point
 * to a programme of work, and the UI, the terms and the acceptable-use policy
 * all assert 18+ today.
 */
export const MINIMUM_AGE_YEARS = 18;

export function meetsMinimumAge(dateOfBirth: string, on: Date = new Date()): boolean {
  const age = ageOn(dateOfBirth, on);
  return Number.isFinite(age) && age >= MINIMUM_AGE_YEARS;
}
