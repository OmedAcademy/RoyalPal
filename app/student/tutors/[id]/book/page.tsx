import { notFound } from "next/navigation";
import Link from "next/link";
import { requireProfile } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { getTutorById } from "@/lib/supabase/tutor-search";
import { getTutorAvailableSlots } from "@/lib/supabase/availability";
import { utcToZonedParts } from "@/lib/utils/timezone";
import { LessonTypeSelector } from "@/components/booking/LessonTypeSelector";
import { BookingForm, type SlotGroup } from "@/components/booking/BookingForm";

export default async function BookTutorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lessonType?: string; payment?: string }>;
}) {
  await requireProfile(["student"]);
  const { id } = await params;
  const { lessonType: rawLessonType, payment } = await searchParams;

  const tutor = await getTutorById(id);
  if (!tutor) notFound();

  const lessonType =
    rawLessonType === "trial" && tutor.trial_price_cents !== null ? "trial" : "standard";
  const durationMinutes = lessonType === "trial" ? 30 : 60;

  const supabase = await createClient();
  const { data: tutorProfile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", id)
    .maybeSingle();
  const timeZone = tutorProfile?.timezone ?? "UTC";

  const [{ data: subjects }, slots] = await Promise.all([
    tutor.subject_ids.length
      ? supabase.from("subjects").select("*").in("id", tutor.subject_ids)
      : Promise.resolve({ data: [] }),
    getTutorAvailableSlots({ tutorId: id, timeZone, durationMinutes }),
  ]);

  const groups = new Map<string, SlotGroup>();
  for (const slot of slots) {
    const { date } = utcToZonedParts(slot.startAt, timeZone);
    if (!groups.has(date)) {
      groups.set(date, {
        date,
        label: new Intl.DateTimeFormat("en-US", {
          timeZone,
          weekday: "long",
          month: "short",
          day: "numeric",
        }).format(slot.startAt),
        slots: [],
      });
    }
    groups.get(date)!.slots.push({
      startAt: slot.startAt.toISOString(),
      label: new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
      }).format(slot.startAt),
    });
  }

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <Link
          href={`/student/tutors/${id}`}
          className="text-sm text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
        >
          &larr; Back to {tutor.full_name}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Book a lesson with {tutor.full_name}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Times are shown in the tutor&apos;s time zone ({timeZone}).
        </p>
        {payment === "cancelled" && (
          <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            Checkout was cancelled and that booking was released — pick a new time below when
            you&apos;re ready.
          </p>
        )}
        {!tutor.stripe_charges_enabled && (
          <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            This tutor is not yet accepting payments
            {tutor.trial_price_cents !== null
              ? " for standard lessons — a trial lesson is still bookable below."
              : "."}
          </p>
        )}
      </div>

      <LessonTypeSelector
        lessonType={lessonType}
        hourlyRateCents={tutor.hourly_rate_cents}
        trialPriceCents={tutor.trial_price_cents}
        currency={tutor.currency}
      />

      {lessonType === "standard" && !tutor.stripe_charges_enabled ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Standard lessons aren&apos;t bookable for this tutor yet.
        </p>
      ) : (
        <BookingForm
          tutorId={id}
          subjects={(subjects ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
          slotGroups={Array.from(groups.values())}
          durationMinutes={durationMinutes}
          lessonType={lessonType}
        />
      )}
    </div>
  );
}
