import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ component: "account-erasure" });

/** How long someone has to change their mind, or notice an account takeover. */
export const DELETION_GRACE_DAYS = 14;

/**
 * What erasure means here, stated plainly because the gap between "delete my
 * account" and what any marketplace can actually do is where trust is lost.
 *
 * WE REMOVE
 *   name, avatar, country, phone, date of birth, the tutor biography and every
 *   other free-text profile field, and the email address on the auth record —
 *   which also makes the account unusable, since there is nothing left to sign
 *   in with.
 *
 * WE KEEP
 *   that a lesson happened, what was paid, and the messages exchanged.
 *
 * WHY WE KEEP IT
 *   A lesson has two people in it. Erasing one of them would erase the other
 *   person's record of their own lesson, their own payment and their own
 *   conversation — and a safeguarding report about a user who then deletes
 *   their account would erase the evidence of the thing being reported. The
 *   payment rows are also financial records with their own retention duties.
 *
 * >>> REQUIRES LEGAL REVIEW <<<
 * The balance struck above — erasure of identifiers, retention of
 * transactional and evidential records — is the common one, but the specific
 * retention periods, and whether message CONTENT may be retained against an
 * erasure request, are legal questions this file cannot answer. It is written
 * so the answer changes in one place.
 *
 * NOT A HARD DELETE, and not by omission: profiles.id references auth.users
 * with ON DELETE CASCADE, while bookings reference profiles with no cascade
 * at all. Deleting the auth user would therefore either fail against the
 * booking foreign keys or, if those were ever loosened, silently destroy the
 * platform's record of money it processed.
 */
const TOMBSTONE_NAME = "Deleted user";

export async function anonymizeAccount(userId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("role, anonymized_at")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return;
  // Idempotent: the maintenance job may retry, and a second pass must not
  // overwrite the tombstone with another tombstone or re-send anything.
  if (profile.anonymized_at) return;

  const now = new Date().toISOString();

  await admin
    .from("profiles")
    .update({
      full_name: TOMBSTONE_NAME,
      avatar_url: null,
      country: null,
      phone: null,
      date_of_birth: null,
      anonymized_at: now,
      // Suspended as well as anonymised: suspension is what every other layer
      // already checks, so the account loses access through the same path an
      // ordinary suspension uses rather than a new one.
      status: "suspended",
    })
    .eq("id", userId);

  if (profile.role === "tutor") {
    // A tutor profile is public. Everything free-text goes, and verification
    // is revoked so the listing disappears from search immediately rather
    // than lingering as an empty card.
    await admin
      .from("tutor_profiles")
      .update({
        headline: TOMBSTONE_NAME,
        bio: "",
        video_url: null,
        certifications: [],
        education: null,
        availability_note: null,
        verification_status: "rejected",
        rejection_reason: "Account deleted",
      })
      .eq("id", userId);
  } else {
    await admin
      .from("student_profiles")
      .update({ learning_goals: null, target_languages: null, native_language: null })
      .eq("id", userId);
  }

  // Devices stop receiving anything. Deleted rather than disabled — there is
  // no longer an account for them to belong to.
  await admin.from("push_tokens").delete().eq("user_id", userId);

  // The email is the last identifier and the only remaining way in. Replacing
  // it rather than deleting the auth row keeps every foreign key intact.
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    email: `deleted+${userId}@royalpal.invalid`,
    user_metadata: {},
  });
  if (authError) {
    log.error("failed to scrub auth identifiers", authError, { userId });
  }

  log.info("account anonymized", { userId });
}

/**
 * Carries out every deletion request whose grace period has expired.
 * Returns how many accounts were processed, for the job's own report.
 */
export async function anonymizeDueAccounts(): Promise<number> {
  const admin = createAdminClient();

  const { data: due, error } = await admin
    .from("account_deletion_requests")
    .select("id, user_id")
    .is("cancelled_at", null)
    .is("completed_at", null)
    .lte("scheduled_for", new Date().toISOString())
    .limit(100);

  if (error) throw error;
  if (!due || due.length === 0) return 0;

  let processed = 0;
  for (const request of due) {
    try {
      await anonymizeAccount(request.user_id);
      await admin
        .from("account_deletion_requests")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", request.id);
      processed += 1;
    } catch (err) {
      // One failure must not abandon the rest of the batch; the request stays
      // un-completed and is retried on the next run.
      log.error("failed to anonymize account", err, { userId: request.user_id });
    }
  }

  return processed;
}
