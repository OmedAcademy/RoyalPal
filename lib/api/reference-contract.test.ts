import { describe, it, expect } from "vitest";
import { LANGUAGE_SELECT_OPTIONS, LANGUAGE_NAME_SET } from "@/lib/constants/languages";
import { COUNTRY_SELECT_OPTIONS, COUNTRY_NAME_SET } from "@/lib/constants/countries";
import { ENGLISH_LEVELS, SPECIALIZATIONS } from "@/lib/constants/profile-options";
import { studentProfileSchema, tutorProfileSchema } from "@/lib/validations/profile";

/**
 * GET /api/v1/reference serves the option lists the mobile profile editor
 * renders, and the phone posts the chosen VALUE straight back to
 * PUT /api/v1/profile — which validates against these same sets.
 *
 * The two ends being different datasets is the failure this pins: an earlier
 * draft of the reference route served ISO codes ("fr", "GB") while validation
 * checks canonical names ("French", "United Kingdom"), so every save from the
 * phone would have failed with "Select a language from the list" and no way
 * for the person to comply.
 */
describe("reference endpoint option contract", () => {
  it("serves language values the profile schemas accept", () => {
    expect(LANGUAGE_SELECT_OPTIONS.length).toBeGreaterThan(0);
    for (const option of LANGUAGE_SELECT_OPTIONS) {
      expect(LANGUAGE_NAME_SET.has(option.value)).toBe(true);
    }
  });

  it("serves country values the profile schemas accept", () => {
    expect(COUNTRY_SELECT_OPTIONS.length).toBeGreaterThan(0);
    for (const option of COUNTRY_SELECT_OPTIONS) {
      expect(COUNTRY_NAME_SET.has(option.value)).toBe(true);
    }
  });

  it("round-trips a student payload built from the served options", () => {
    const language = LANGUAGE_SELECT_OPTIONS[0].value;
    const parsed = studentProfileSchema.safeParse({
      fullName: "Sam Student",
      country: COUNTRY_SELECT_OPTIONS[0].value,
      nativeLanguage: language,
      targetLanguages: [language],
      englishLevel: ENGLISH_LEVELS[0],
      learningGoals: "Pass IELTS",
      timezone: "Europe/London",
    });
    expect(parsed.success).toBe(true);
  });

  it("round-trips a tutor payload built from the served options", () => {
    const language = LANGUAGE_SELECT_OPTIONS[0].value;
    const parsed = tutorProfileSchema.safeParse({
      fullName: "Tara Tutor",
      headline: "IELTS specialist",
      bio: "Ten years of exam prep.",
      languagesSpoken: [language],
      teachingLanguages: [language],
      specializations: [SPECIALIZATIONS[0]],
      yearsExperience: "10",
      certifications: ["CELTA"],
      education: "MA Applied Linguistics",
      hourlyPrice: "30",
      trialPrice: "",
      availabilityNote: "",
      subjectIds: [1],
      country: COUNTRY_SELECT_OPTIONS[0].value,
      timezone: "Europe/London",
      videoUrl: "",
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("serves English levels and specializations the tutor schema enumerates", () => {
    // These two are z.enum()s, so a drifting list is a hard rejection rather
    // than a soft one.
    for (const level of ENGLISH_LEVELS) {
      expect(
        studentProfileSchema.safeParse({
          fullName: "Sam",
          country: COUNTRY_SELECT_OPTIONS[0].value,
          nativeLanguage: "",
          targetLanguages: [],
          englishLevel: level,
          learningGoals: "",
          timezone: "UTC",
        }).success,
      ).toBe(true);
    }
    for (const specialization of SPECIALIZATIONS) {
      expect(tutorProfileSchema.shape.specializations.safeParse([specialization]).success).toBe(
        true,
      );
    }
  });
});
