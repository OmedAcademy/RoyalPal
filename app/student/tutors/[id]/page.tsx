import { notFound } from "next/navigation";
import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { getTutorById } from "@/lib/supabase/tutor-search";

function priceLabel(cents: number, currency: string): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

export default async function TutorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["student"]);
  const { id } = await params;

  const tutor = await getTutorById(id);
  if (!tutor) {
    notFound();
  }

  const supabase = await createClient();
  const { data: subjects } = tutor.subject_ids.length
    ? await supabase.from("subjects").select("*").in("id", tutor.subject_ids)
    : { data: [] };

  const initial = tutor.full_name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          {tutor.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tutor.avatar_url}
              alt={tutor.full_name}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-2xl font-semibold text-zinc-500">
              {initial}
            </span>
          )}
        </div>
        <div>
          <h1 className="text-xl font-semibold">{tutor.full_name}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{tutor.headline}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-zinc-500 dark:text-zinc-400">Hourly rate</p>
          <p className="font-medium">{priceLabel(tutor.hourly_rate_cents, tutor.currency)}</p>
        </div>
        {tutor.trial_price_cents !== null && (
          <div>
            <p className="text-zinc-500 dark:text-zinc-400">Trial lesson</p>
            <p className="font-medium">{priceLabel(tutor.trial_price_cents, tutor.currency)}</p>
          </div>
        )}
        <div>
          <p className="text-zinc-500 dark:text-zinc-400">Rating</p>
          <p className="font-medium">
            {tutor.avg_rating !== null
              ? `★ ${tutor.avg_rating.toFixed(1)} (${tutor.total_reviews})`
              : "No reviews yet"}
          </p>
        </div>
      </div>

      {subjects && subjects.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium">Subjects</h2>
          <div className="flex flex-wrap gap-1.5">
            {subjects.map((subject) => (
              <span
                key={subject.id}
                className="rounded-full bg-black/5 px-2.5 py-1 text-xs text-zinc-700 dark:bg-white/10 dark:text-zinc-300"
              >
                {subject.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {tutor.teaching_languages.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-medium">Teaches in</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {tutor.teaching_languages.join(", ")}
          </p>
        </div>
      )}

      {tutor.specializations.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-medium">Specializations</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {tutor.specializations.join(", ")}
          </p>
        </div>
      )}

      <div>
        <h2 className="mb-1 text-sm font-medium">About</h2>
        <p className="text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{tutor.bio}</p>
      </div>

      {tutor.video_url && (
        <a
          href={tutor.video_url}
          target="_blank"
          rel="noreferrer"
          className="w-fit text-sm font-medium underline underline-offset-2"
        >
          Watch intro video
        </a>
      )}

      <Link
        href={`/student/tutors/${tutor.id}/book`}
        className="bg-foreground text-background w-fit rounded-md px-4 py-2 font-medium"
      >
        Book a lesson
      </Link>
    </div>
  );
}
