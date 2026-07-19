"use client";

import { useActionState } from "react";
import { upsertTutorProfile, type ProfileActionState } from "@/lib/actions/profile";
import { TextField } from "@/components/ui/TextField";
import { TextArea } from "@/components/ui/TextArea";
import { SelectField } from "@/components/ui/SelectField";
import { CheckboxGroup } from "@/components/ui/CheckboxGroup";
import { COUNTRIES } from "@/lib/constants/countries";
import { LANGUAGES } from "@/lib/constants/languages";
import { SPECIALIZATIONS } from "@/lib/constants/profile-options";
import type { Profile, TutorProfile } from "@/types/database";

const initialState: ProfileActionState = {};

function centsToPrice(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return Math.round(cents) / 100;
}

export function TutorProfileForm({
  profile,
  tutorProfile,
  timezones,
}: {
  profile: Profile;
  tutorProfile: TutorProfile | null;
  timezones: string[];
}) {
  const [state, formAction, pending] = useActionState(upsertTutorProfile, initialState);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-5">
      <TextField label="Full name" name="fullName" defaultValue={profile.full_name} required />

      <TextField
        label="Headline"
        name="headline"
        defaultValue={tutorProfile?.headline}
        required
        maxLength={150}
        placeholder="e.g. IELTS specialist with 8 years of teaching experience"
      />

      <TextArea
        label="Bio / About"
        name="bio"
        defaultValue={tutorProfile?.bio}
        required
        maxLength={5000}
        rows={6}
        placeholder="Tell students about your teaching style, background, and what makes your lessons effective."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label="Country" name="country" options={COUNTRIES} defaultValue={profile.country} />
        <SelectField
          label="Time zone"
          name="timezone"
          options={timezones}
          defaultValue={profile.timezone}
          required
        />
      </div>

      <CheckboxGroup
        label="Languages you speak"
        name="languagesSpoken"
        options={LANGUAGES}
        defaultValues={tutorProfile?.languages_spoken}
      />

      <CheckboxGroup
        label="Languages you teach"
        name="teachingLanguages"
        options={LANGUAGES}
        defaultValues={tutorProfile?.teaching_languages}
      />

      <CheckboxGroup
        label="Specializations"
        name="specializations"
        options={SPECIALIZATIONS}
        defaultValues={tutorProfile?.specializations}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Years of experience"
          name="yearsExperience"
          type="number"
          min={0}
          max={80}
          defaultValue={tutorProfile?.years_experience}
        />
        <TextField
          label="Intro video URL"
          name="videoUrl"
          type="url"
          defaultValue={tutorProfile?.video_url}
          placeholder="https://youtube.com/..."
        />
      </div>

      <TextArea
        label="Certifications"
        name="certifications"
        defaultValue={tutorProfile?.certifications?.join("\n")}
        rows={3}
        hint="One per line, e.g. CELTA, TESOL"
      />

      <TextArea
        label="Education"
        name="education"
        defaultValue={tutorProfile?.education}
        maxLength={2000}
        rows={3}
        placeholder="e.g. B.A. in English Literature, University of..."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Hourly price (USD)"
          name="hourlyPrice"
          type="number"
          min={1}
          step={0.01}
          required
          defaultValue={centsToPrice(tutorProfile?.hourly_rate_cents)}
        />
        <TextField
          label="Trial lesson price (USD)"
          name="trialPrice"
          type="number"
          min={1}
          step={0.01}
          defaultValue={centsToPrice(tutorProfile?.trial_price_cents)}
        />
      </div>

      <TextArea
        label="Availability"
        name="availabilityNote"
        defaultValue={tutorProfile?.availability_note}
        maxLength={500}
        rows={2}
        placeholder="e.g. Weekday evenings and weekends (full scheduling arrives in a later milestone)"
        hint="Placeholder for now — full calendar-based availability lands in a later milestone."
      />

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-foreground text-background w-fit rounded-md px-4 py-2 font-medium disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}
