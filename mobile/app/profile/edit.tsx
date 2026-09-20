import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { router, Stack } from "expo-router";
import { api } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { useAuth } from "@/lib/auth";
import {
  Screen,
  Heading,
  Body,
  Card,
  Field,
  Button,
  Loading,
  ErrorState,
  STACK_EDGES,
} from "@/components/ui";
import { Chooser, type Choice } from "@/components/Chooser";
import { spacing } from "@/lib/theme";

type Reference = {
  languages: { value: string; label: string }[];
  countries: { value: string; label: string }[];
  timezones: string[];
  englishLevels: { value: string; label: string }[];
  specializations: readonly string[];
  subjects: { id: number; name: string; category: string | null }[];
};

type ProfileResponse = {
  role: "student" | "tutor" | "admin";
  profile: {
    fullName: string;
    country: string | null;
    timezone: string;
    avatarUrl: string | null;
  };
  roleProfile: Record<string, unknown> | null;
  subjectIds: number[];
};

const str = (row: Record<string, unknown> | null, key: string) =>
  typeof row?.[key] === "string" ? (row[key] as string) : "";
const num = (row: Record<string, unknown> | null, key: string) =>
  typeof row?.[key] === "number" ? (row[key] as number) : null;
const list = (row: Record<string, unknown> | null, key: string) =>
  Array.isArray(row?.[key]) ? (row[key] as string[]) : [];

/**
 * Editing your own profile, on the phone.
 *
 * Every field posts to PUT /api/v1/profile, which runs the same Server Action
 * the web form posts to — so the Zod schema, the column allowlist and the
 * privileged-column locks are enforced once, on the server, for both clients.
 * Nothing here decides what may be written; it decides what may be typed.
 *
 * Which form you get is decided by the role the SERVER reports, and the server
 * picks the action by that same role. A student cannot reach the tutor form,
 * and could not write a tutor row by posting one.
 */
export default function EditProfileScreen() {
  const { refresh } = useAuth();
  const profileState = useApi<ProfileResponse>("/api/v1/profile");
  const referenceState = useApi<Reference>("/api/v1/reference");

  // Shared across both roles.
  const [fullName, setFullName] = useState("");
  const [country, setCountry] = useState<string[]>([]);
  const [timezone, setTimezone] = useState<string[]>([]);

  // Student.
  const [nativeLanguage, setNativeLanguage] = useState<string[]>([]);
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [englishLevel, setEnglishLevel] = useState<string[]>([]);
  const [learningGoals, setLearningGoals] = useState("");

  // Tutor.
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [languagesSpoken, setLanguagesSpoken] = useState<string[]>([]);
  const [teachingLanguages, setTeachingLanguages] = useState<string[]>([]);
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [yearsExperience, setYearsExperience] = useState("");
  const [certifications, setCertifications] = useState("");
  const [education, setEducation] = useState("");
  const [hourlyPrice, setHourlyPrice] = useState("");
  const [trialPrice, setTrialPrice] = useState("");
  const [availabilityNote, setAvailabilityNote] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [subjectIds, setSubjectIds] = useState<string[]>([]);

  const loaded = profileState.data;

  // Prefill once the server's copy arrives. Keyed on the payload rather than
  // running on mount: the fetch has not resolved on the first render, and
  // overwriting typed text on a later refetch would be worse than useless.
  useEffect(() => {
    if (!loaded) return;
    const role = loaded.roleProfile;
    setFullName(loaded.profile.fullName ?? "");
    setCountry(loaded.profile.country ? [loaded.profile.country] : []);
    setTimezone(loaded.profile.timezone ? [loaded.profile.timezone] : []);

    if (loaded.role === "tutor") {
      setHeadline(str(role, "headline"));
      setBio(str(role, "bio"));
      setLanguagesSpoken(list(role, "languages_spoken"));
      setTeachingLanguages(list(role, "teaching_languages"));
      setSpecializations(list(role, "specializations"));
      const years = num(role, "years_experience");
      setYearsExperience(years === null ? "" : String(years));
      setCertifications(list(role, "certifications").join("\n"));
      setEducation(str(role, "education"));
      const hourly = num(role, "hourly_rate_cents");
      setHourlyPrice(hourly === null ? "" : (hourly / 100).toFixed(2));
      const trial = num(role, "trial_price_cents");
      setTrialPrice(trial === null ? "" : (trial / 100).toFixed(2));
      setAvailabilityNote(str(role, "availability_note"));
      setVideoUrl(str(role, "video_url"));
      setSubjectIds(loaded.subjectIds.map(String));
    } else {
      setNativeLanguage(str(role, "native_language") ? [str(role, "native_language")] : []);
      setTargetLanguages(list(role, "target_languages"));
      setEnglishLevel(str(role, "english_level") ? [str(role, "english_level")] : []);
      setLearningGoals(str(role, "learning_goals"));
    }
  }, [loaded]);

  const save = useMutation(async (body: Record<string, unknown>) =>
    api.put<{ ok: boolean; message: string | null }>("/api/v1/profile", body),
  );

  if (profileState.loading || referenceState.loading) return <Loading />;
  if (profileState.error || !profileState.data || referenceState.error || !referenceState.data) {
    return (
      <Screen edges={STACK_EDGES}>
        <ErrorState
          message={profileState.error ?? referenceState.error ?? "We couldn't load your profile."}
          onRetry={
            profileState.retryable || referenceState.retryable
              ? () => {
                  profileState.reload();
                  referenceState.reload();
                }
              : undefined
          }
        />
      </Screen>
    );
  }

  const reference = referenceState.data;
  const isTutor = profileState.data.role === "tutor";
  const timezoneChoices: Choice[] = reference.timezones.map((zone) => ({
    value: zone,
    label: zone.replace(/_/g, " "),
  }));
  const subjectChoices: Choice[] = reference.subjects.map((subject) => ({
    value: String(subject.id),
    label: subject.name,
    group: subject.category ?? undefined,
  }));

  async function onSave() {
    const shared = {
      fullName: fullName.trim(),
      country: country[0] ?? "",
      timezone: timezone[0] ?? "",
    };
    const body = isTutor
      ? {
          ...shared,
          headline: headline.trim(),
          bio: bio.trim(),
          languagesSpoken,
          teachingLanguages,
          specializations,
          yearsExperience: yearsExperience.trim(),
          certifications: certifications
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          education: education.trim(),
          hourlyPrice: hourlyPrice.trim(),
          trialPrice: trialPrice.trim(),
          availabilityNote: availabilityNote.trim(),
          videoUrl: videoUrl.trim(),
          subjectIds: subjectIds.map(Number),
        }
      : {
          ...shared,
          nativeLanguage: nativeLanguage[0] ?? "",
          targetLanguages,
          englishLevel: englishLevel[0] ?? "",
          learningGoals: learningGoals.trim(),
        };

    const result = await save.run(body);
    if (!result) return;
    // The name and time zone shown elsewhere in the app come from the auth
    // context, which is now a version behind.
    await refresh();
    router.back();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Edit profile" }} />
      <Heading>Edit profile</Heading>

      <Card>
        <Field label="Full name" value={fullName} onChangeText={setFullName} maxLength={200} />
        <Chooser
          label="Country"
          choices={reference.countries}
          selected={country}
          onChange={setCountry}
          placeholder="Choose a country"
        />
        <Chooser
          label="Time zone"
          hint="Lesson times are shown in this zone everywhere in RoyalPal."
          choices={timezoneChoices}
          selected={timezone}
          onChange={setTimezone}
          placeholder="Choose a time zone"
        />
      </Card>

      {isTutor ? (
        <>
          <Card>
            <Text style={{ fontWeight: "600" }}>How students see you</Text>
            <Field
              label="Headline"
              value={headline}
              onChangeText={setHeadline}
              maxLength={150}
              hint="One line. It sits under your name in search."
            />
            <Field label="Bio" value={bio} onChangeText={setBio} multiline maxLength={5000} />
            <Field
              label="Intro video URL"
              value={videoUrl}
              onChangeText={setVideoUrl}
              autoCapitalize="none"
              keyboardType="url"
              hint="Optional. Must start with http:// or https://"
            />
          </Card>

          <Card>
            <Text style={{ fontWeight: "600" }}>What you teach</Text>
            <Chooser
              label="Subjects"
              multiple
              choices={subjectChoices}
              selected={subjectIds}
              onChange={setSubjectIds}
              placeholder="Choose subjects"
            />
            <Chooser
              label="Languages you teach in"
              multiple
              choices={reference.languages}
              selected={teachingLanguages}
              onChange={setTeachingLanguages}
              placeholder="Choose languages"
            />
            <Chooser
              label="Languages you speak"
              multiple
              choices={reference.languages}
              selected={languagesSpoken}
              onChange={setLanguagesSpoken}
              placeholder="Choose languages"
            />
            <Chooser
              label="Specializations"
              multiple
              choices={reference.specializations.map((value) => ({ value, label: value }))}
              selected={specializations}
              onChange={setSpecializations}
              placeholder="Choose specializations"
            />
          </Card>

          <Card>
            <Text style={{ fontWeight: "600" }}>Experience</Text>
            <Field
              label="Years of experience"
              value={yearsExperience}
              onChangeText={setYearsExperience}
              keyboardType="number-pad"
              hint="Optional."
            />
            <Field
              label="Certifications"
              value={certifications}
              onChangeText={setCertifications}
              multiline
              hint="One per line."
            />
            <Field
              label="Education"
              value={education}
              onChangeText={setEducation}
              multiline
              maxLength={2000}
            />
          </Card>

          <Card>
            <Text style={{ fontWeight: "600" }}>Pricing</Text>
            <Field
              label="Hourly price"
              value={hourlyPrice}
              onChangeText={setHourlyPrice}
              keyboardType="decimal-pad"
              hint="Per hour, before RoyalPal's commission."
            />
            <Field
              label="Trial lesson price"
              value={trialPrice}
              onChangeText={setTrialPrice}
              keyboardType="decimal-pad"
              hint="Optional. Leave blank if you don't offer trials."
            />
            <Field
              label="Availability note"
              value={availabilityNote}
              onChangeText={setAvailabilityNote}
              multiline
              maxLength={500}
              hint="Optional. Anything your calendar can't say."
            />
          </Card>
        </>
      ) : (
        <Card>
          <Text style={{ fontWeight: "600" }}>Your learning</Text>
          <Chooser
            label="Native language"
            choices={reference.languages}
            selected={nativeLanguage}
            onChange={setNativeLanguage}
            placeholder="Choose a language"
          />
          <Chooser
            label="Languages you're learning"
            multiple
            choices={reference.languages}
            selected={targetLanguages}
            onChange={setTargetLanguages}
            placeholder="Choose languages"
          />
          <Chooser
            label="English level"
            choices={reference.englishLevels}
            selected={englishLevel}
            onChange={setEnglishLevel}
            placeholder="Choose a level"
          />
          <Field
            label="Learning goals"
            value={learningGoals}
            onChangeText={setLearningGoals}
            multiline
            maxLength={2000}
            hint="Tutors see this when you book."
          />
        </Card>
      )}

      {save.error ? (
        <View accessibilityRole="alert" style={{ gap: spacing.xs }}>
          <Body>{save.error}</Body>
        </View>
      ) : null}

      <Button onPress={onSave} busy={save.busy}>
        {save.busy ? "Saving…" : "Save changes"}
      </Button>
      <Button variant="secondary" onPress={() => router.back()}>
        Cancel
      </Button>
    </Screen>
  );
}
