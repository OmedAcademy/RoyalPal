"use client";

import { useActionState } from "react";
import { updateStudentProfile, type ProfileActionState } from "@/lib/actions/profile";
import { TextField } from "@/components/ui/TextField";
import { TextArea } from "@/components/ui/TextArea";
import { SelectField } from "@/components/ui/SelectField";
import { CheckboxGroup } from "@/components/ui/CheckboxGroup";
import { COUNTRIES } from "@/lib/constants/countries";
import { LANGUAGES } from "@/lib/constants/languages";
import { ENGLISH_LEVEL_LABELS } from "@/lib/constants/profile-options";
import type { Profile, StudentProfile } from "@/types/database";

const initialState: ProfileActionState = {};

const ENGLISH_LEVEL_OPTIONS = Object.entries(ENGLISH_LEVEL_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function StudentProfileForm({
  profile,
  studentProfile,
  timezones,
}: {
  profile: Profile;
  studentProfile: StudentProfile | null;
  timezones: string[];
}) {
  const [state, formAction, pending] = useActionState(updateStudentProfile, initialState);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-5">
      <TextField label="Full name" name="fullName" defaultValue={profile.full_name} required />

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

      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          label="Native language"
          name="nativeLanguage"
          options={LANGUAGES}
          defaultValue={studentProfile?.native_language ?? null}
        />
        <SelectField
          label="English level"
          name="englishLevel"
          options={ENGLISH_LEVEL_OPTIONS}
          defaultValue={studentProfile?.english_level ?? null}
        />
      </div>

      <CheckboxGroup
        label="Target language(s) — what you want to learn"
        name="targetLanguages"
        options={LANGUAGES}
        defaultValues={studentProfile?.target_languages}
      />

      <TextArea
        label="Learning goals"
        name="learningGoals"
        defaultValue={studentProfile?.learning_goals}
        maxLength={2000}
        rows={4}
        placeholder="What do you want to achieve? e.g. pass IELTS with a 7, feel confident in work meetings..."
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
