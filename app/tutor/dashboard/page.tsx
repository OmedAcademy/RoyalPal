import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { getTutorDashboard } from "@/lib/supabase/dashboard";
import { computeTutorProfileCompletion } from "@/lib/utils/profile-completion";
import { formatMoney } from "@/lib/utils/format";
import { greeting } from "@/lib/utils/greeting";
import { Card, StatTile } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { LessonRow } from "@/components/dashboard/LessonRow";
import { ButtonLink } from "@/components/ui/Button";
import { PayoutStatusBanner } from "@/components/tutor/PayoutStatusBanner";
import { isStripeConfigured } from "@/lib/stripe/client";
import type { ReviewWithAuthor } from "@/lib/supabase/reviews";

const VERIFICATION_BADGE: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  rejected: "bg-red-100 text-red-700",
};

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="text-muted py-2 text-sm">{children}</p>;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5`} className="text-amber-500">
      {"★".repeat(rating)}
      <span className="text-slate-300">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function ReviewLine({ review }: { review: ReviewWithAuthor }) {
  return (
    <div className="border-hairline border-b py-3 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{review.author_name}</span>
        <Stars rating={review.rating} />
      </div>
      {review.comment && <p className="text-muted mt-1 text-sm">{review.comment}</p>}
    </div>
  );
}

export default async function TutorDashboardPage() {
  const profile = await requireProfile(["tutor"]);
  const supabase = await createClient();

  const { data: tutorProfile } = await supabase
    .from("tutor_profiles")
    .select("*")
    .eq("id", profile.id)
    .maybeSingle();

  const completion = computeTutorProfileCompletion(profile, tutorProfile);
  const currency = tutorProfile?.currency ?? "usd";
  const dash = await getTutorDashboard(profile.id, profile.timezone, currency);
  const tz = profile.timezone;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-muted text-sm">{greeting(tz)},</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {profile.full_name}
          </h1>
        </div>
        {tutorProfile && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${VERIFICATION_BADGE[tutorProfile.verification_status]}`}
          >
            {tutorProfile.verification_status === "approved"
              ? "Verified tutor"
              : tutorProfile.verification_status === "pending"
                ? "Verification pending"
                : "Verification rejected"}
          </span>
        )}
      </div>

      {tutorProfile && (
        <PayoutStatusBanner stripeConfigured={isStripeConfigured()} account={tutorProfile} />
      )}

      {/* Profile setup prompt */}
      {!tutorProfile && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-medium">Set up your tutor profile</p>
              <p className="text-muted mt-1 text-sm">
                Add your headline, subjects, and rate so an admin can review and approve you.
              </p>
            </div>
            <ButtonLink href="/tutor/profile">Complete profile</ButtonLink>
          </div>
        </Card>
      )}

      {/* Earnings / stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Earned" value={formatMoney(dash.earnings.earnedCents, currency)} />
        <StatTile
          label="Scheduled"
          value={formatMoney(dash.earnings.scheduledCents, currency)}
          hint="Confirmed upcoming"
        />
        <StatTile label="Lessons taught" value={dash.earnings.lessonsCompleted} />
        <StatTile
          label="Rating"
          value={tutorProfile?.avg_rating != null ? tutorProfile.avg_rating.toFixed(1) : "—"}
          hint={`${tutorProfile?.total_reviews ?? 0} reviews`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card
            title="Today's lessons"
            action={
              <Link
                href="/tutor/bookings"
                className="text-royal text-sm font-medium hover:underline"
              >
                All bookings
              </Link>
            }
          >
            {dash.today.length === 0 ? (
              <EmptyRow>No lessons scheduled today. Enjoy the breathing room.</EmptyRow>
            ) : (
              dash.today.map((b) => (
                <LessonRow key={b.id} booking={b} viewerRole="tutor" viewerTimezone={tz} />
              ))
            )}
          </Card>

          <Card title="Upcoming lessons">
            {dash.upcoming.length === 0 ? (
              <EmptyRow>Nothing on the calendar yet beyond today.</EmptyRow>
            ) : (
              dash.upcoming
                .slice(0, 6)
                .map((b) => (
                  <LessonRow key={b.id} booking={b} viewerRole="tutor" viewerTimezone={tz} />
                ))
            )}
          </Card>

          <Card title="Pending bookings">
            {dash.pending.length === 0 ? (
              <EmptyRow>No bookings awaiting payment.</EmptyRow>
            ) : (
              dash.pending.map((b) => (
                <LessonRow key={b.id} booking={b} viewerRole="tutor" viewerTimezone={tz} />
              ))
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          <Card title="Profile completion">
            <ProgressBar percentage={completion} />
            <ButtonLink href="/tutor/profile" variant="secondary" size="md" className="mt-4 w-full">
              {completion < 100 ? "Complete your profile" : "Edit profile"}
            </ButtonLink>
          </Card>

          <Card title="Quick actions" bodyClassName="flex flex-col gap-2">
            <Link
              href="/tutor/availability"
              className="border-hairline hover:border-royal rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors"
            >
              🗓 Set your availability
            </Link>
            <Link
              href="/tutor/bookings"
              className="border-hairline hover:border-royal rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors"
            >
              📚 Manage bookings
            </Link>
            {tutorProfile?.verification_status === "approved" && (
              <Link
                href={`/student/tutors/${profile.id}`}
                className="border-hairline hover:border-royal rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors"
              >
                ✦ View public profile
              </Link>
            )}
          </Card>

          <Card title="Recent reviews">
            {dash.recentReviews.length === 0 ? (
              <EmptyRow>No reviews yet — they&apos;ll appear here after your lessons.</EmptyRow>
            ) : (
              dash.recentReviews.map((r) => <ReviewLine key={r.id} review={r} />)
            )}
          </Card>

          <Card title="Messages">
            <p className="text-muted py-2 text-sm">
              A conversation opens with every student who books you.
            </p>
            <Link href="/messages" className="text-royal text-sm font-medium hover:underline">
              Open messages →
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
