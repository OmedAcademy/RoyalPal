import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { getStudentDashboard } from "@/lib/supabase/dashboard";
import { greeting } from "@/lib/utils/greeting";
import { Card, StatTile } from "@/components/ui/Card";
import { LessonRow } from "@/components/dashboard/LessonRow";
import { TutorCard } from "@/components/tutor/TutorCard";
import { getFavoriteTutorIds } from "@/lib/supabase/favorites";
import { ButtonLink } from "@/components/ui/Button";
import type { Subject } from "@/types/database";

export default async function StudentDashboardPage() {
  const profile = await requireProfile(["student"]);
  const supabase = await createClient();

  const [dash, { data: subjectRows }, favoriteIds] = await Promise.all([
    getStudentDashboard(profile.id),
    supabase.from("subjects").select("*"),
    getFavoriteTutorIds(),
  ]);

  const subjectsById = new Map<number, Subject>((subjectRows ?? []).map((s) => [s.id, s]));
  const tz = profile.timezone;
  const completedCount = dash.history.filter((b) => b.status === "completed").length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {/* Header */}
      <div>
        <p className="text-muted text-sm">{greeting(tz)},</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{profile.full_name}</h1>
      </div>

      {/* Continue learning */}
      {dash.nextLesson ? (
        <div className="shadow-luxe border-hairline bg-royal text-royal-contrast overflow-hidden rounded-2xl border">
          <div className="flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <p className="text-xs font-medium tracking-wide text-white/60 uppercase">
                Your next lesson
              </p>
              <p className="mt-2 text-lg font-semibold">
                {dash.nextLesson.subject_name} with {dash.nextLesson.tutor_name}
              </p>
              <p className="mt-1 text-sm text-white/70">
                {new Intl.DateTimeFormat("en-US", {
                  timeZone: tz,
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }).format(new Date(dash.nextLesson.start_at))}
              </p>
            </div>
            <Link
              href="/student/bookings"
              className="rounded-full bg-[color:var(--gold-rich)] px-5 py-2.5 text-sm font-semibold text-[#2a2109] transition-transform hover:-translate-y-0.5"
            >
              View lesson
            </Link>
          </div>
        </div>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-medium">Ready to learn something new?</p>
              <p className="text-muted mt-1 text-sm">
                Browse exceptional tutors and book your first lesson.
              </p>
            </div>
            <ButtonLink href="/student/tutors">Find a tutor</ButtonLink>
          </div>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Upcoming" value={dash.upcoming.length} />
        <StatTile label="Completed" value={completedCount} />
        <StatTile label="To review" value={dash.toReview.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card
            title="Upcoming lessons"
            action={
              <Link
                href="/student/bookings"
                className="text-royal text-sm font-medium hover:underline"
              >
                All bookings
              </Link>
            }
          >
            {dash.upcoming.length === 0 ? (
              <p className="text-muted py-2 text-sm">
                No upcoming lessons.{" "}
                <Link href="/student/tutors" className="text-royal font-medium hover:underline">
                  Find a tutor
                </Link>
                .
              </p>
            ) : (
              dash.upcoming
                .slice(0, 6)
                .map((b) => (
                  <LessonRow key={b.id} booking={b} viewerRole="student" viewerTimezone={tz} />
                ))
            )}
          </Card>

          <Card title="Payment history">
            {dash.payments.length === 0 ? (
              <p className="text-muted py-2 text-sm">No payments yet.</p>
            ) : (
              dash.payments
                .slice(0, 8)
                .map((b) => (
                  <LessonRow key={b.id} booking={b} viewerRole="student" viewerTimezone={tz} />
                ))
            )}
          </Card>

          <Card title="Booking history">
            {dash.history.length === 0 ? (
              <p className="text-muted py-2 text-sm">Your past lessons will appear here.</p>
            ) : (
              dash.history
                .slice(0, 8)
                .map((b) => (
                  <LessonRow key={b.id} booking={b} viewerRole="student" viewerTimezone={tz} />
                ))
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          <Card title="Lessons to review">
            {dash.toReview.length === 0 ? (
              <p className="text-muted py-2 text-sm">You&apos;re all caught up.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-muted text-sm">
                  Share feedback on {dash.toReview.length} completed{" "}
                  {dash.toReview.length === 1 ? "lesson" : "lessons"}.
                </p>
                <ButtonLink
                  href="/student/bookings"
                  variant="secondary"
                  size="md"
                  className="w-full"
                >
                  Leave a review
                </ButtonLink>
              </div>
            )}
          </Card>

          <Card title="Favourite tutors">
            {dash.favorites.length === 0 ? (
              <p className="text-muted py-2 text-sm">
                Tutors you favourite will appear here for quick rebooking.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {dash.favorites.map((tutor) => (
                  <TutorCard key={tutor.id} tutor={tutor} subjectsById={subjectsById} favorited />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Recommended */}
      {dash.recommended.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight">Recommended tutors</h2>
            <Link href="/student/tutors" className="text-royal text-sm font-medium hover:underline">
              Browse all
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dash.recommended.map((tutor) => (
              <TutorCard
                key={tutor.id}
                tutor={tutor}
                subjectsById={subjectsById}
                favorited={favoriteIds.has(tutor.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
