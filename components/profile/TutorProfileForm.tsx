"use client";

import { useActionState } from "react";
import { upsertTutorProfile, type ProfileActionState } from "@/lib/actions/profile";
import { TextField } from "@/components/ui/TextField";
import { TextArea } from "@/components/ui/TextArea";
import { SelectField } from "@/components/ui/SelectField";
import { CheckboxGroup } from "@/components/ui/CheckboxGroup";
import { COUNTRY_SELECT_OPTIONS } from "@/lib/constants/countries";
import { LANGUAGE_NAMES } from "@/lib/constants/languages";
import { SPECIALIZATIONS } from "@/lib/constants/profile-options";
import type { Profile, Subject, TutorProfile } from "@/types/database";

const initialState: ProfileActionState = {};

function centsToPrice(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return Math.round(cents) / 100;
}

export function TutorProfileForm({
  profile,
  tutorProfile,
  timezones,
  subjects,
  selectedSubjectIds,
}: {
  profile: Profile;
  tutorProfile: TutorProfile | null;
  timezones: string[];
  subjects: Subject[];
  selectedSubjectIds: number[];
}) {
  const [state, formAction, pending] = useActionState(upsertTutorProfile, initialState);
  const selected = new Set(selectedSubjectIds);
  const subjectsByCategory = subjects.reduce<Record<string, Subject[]>>((acc, subject) => {
    (acc[subject.category] ??= []).push(subject);
    return acc;
  }, {});

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
        <SelectField
          label="Country"
          name="country"
          options={COUNTRY_SELECT_OPTIONS}
          defaultValue={profile.country}
        />
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
        options={LANGUAGE_NAMES}
        defaultValues={tutorProfile?.languages_spoken}
      />

      <CheckboxGroup
        label="Languages you teach"
        name="teachingLanguages"
        options={LANGUAGE_NAMES}
        defaultValues={tutorProfile?.teaching_languages}
      />

      <CheckboxGroup
        label="Specializations"
        name="specializations"
        options={SPECIALIZATIONS}
        defaultValues={tutorProfile?.specializations}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Subjects you teach</legend>
        {Object.entries(subjectsByCategory).map(([category, categorySubjects]) => (
          <div key={category} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{category}</span>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {categorySubjects.map((subject) => (
                <label key={subject.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="subjectIds"
                    value={subject.id}
                    defaultChecked={selected.has(subject.id)}
                    className="accent-foreground"
                  />
                  {subject.name}
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

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
        placeholder="e.g. Happy to be flexible for regular students"
        hint="A free-text note shown on your profile. Your actual bookable hours are set on the Availability page — that's what students book against."
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
