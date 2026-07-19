import { z } from "zod";
import { COUNTRIES } from "@/lib/constants/countries";
import { LANGUAGES } from "@/lib/constants/languages";
import { ENGLISH_LEVELS, SPECIALIZATIONS } from "@/lib/constants/profile-options";

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null));

const country = z
  .enum(COUNTRIES)
  .optional()
  .or(z.literal(""))
  .transform((value) => (value ? value : null));

const language = z.enum(LANGUAGES);

const languageList = (max: number) => z.array(language).max(max);

export const studentProfileSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required").max(200),
  country,
  nativeLanguage: language
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  targetLanguages: languageList(10),
  englishLevel: z
    .enum(ENGLISH_LEVELS)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  learningGoals: optionalTrimmed(2000),
  timezone: z.string().trim().min(1, "Time zone is required"),
});

export type StudentProfileInput = z.input<typeof studentProfileSchema>;

export const tutorProfileSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required").max(200),
  headline: z.string().trim().min(1, "Headline is required").max(150),
  bio: z.string().trim().min(1, "Bio is required").max(5000),
  languagesSpoken: languageList(10).min(1, "Select at least one language you speak"),
  teachingLanguages: languageList(10).min(1, "Select at least one language you teach"),
  specializations: z.array(z.enum(SPECIALIZATIONS)).max(SPECIALIZATIONS.length),
  // Literal "" must be tried before the coerced-number branch: z.coerce.number()
  // converts "" to 0, which passes .min(0) and wins the union before the
  // empty-string branch ever gets a chance, turning a blank field into 0.
  yearsExperience: z
    .literal("")
    .transform(() => null)
    .or(z.coerce.number().int().min(0).max(80))
    .optional()
    .transform((value) => (value === undefined ? null : value)),
  certifications: z
    .array(z.string().trim().min(1).max(200))
    .max(30)
    .optional()
    .transform((value) => value ?? []),
  education: optionalTrimmed(2000),
  hourlyPrice: z.coerce.number().positive("Enter a price greater than 0"),
  trialPrice: z.coerce
    .number()
    .positive("Enter a price greater than 0")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value === "" || value === undefined ? null : value)),
  availabilityNote: optionalTrimmed(500),
  subjectIds: z
    .array(z.coerce.number().int().positive())
    .max(50)
    .optional()
    .transform((value) => value ?? []),
  country,
  timezone: z.string().trim().min(1, "Time zone is required"),
  videoUrl: z
    .string()
    .trim()
    .url("Enter a valid URL")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
});

export type TutorProfileInput = z.input<typeof tutorProfileSchema>;
