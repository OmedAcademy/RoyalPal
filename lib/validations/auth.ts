import { z } from "zod";
import { MINIMUM_AGE_YEARS, meetsMinimumAge } from "@/lib/utils/age";

/**
 * The 25 passwords that dominate every credential dump, normalised. This is
 * not a serious blocklist and is not pretending to be one — a real deployment
 * should check against a k-anonymity breach API. It is here because the
 * marginal cost is a Set lookup and it removes the passwords that a
 * credential-stuffing run tries first, which is exactly the attack the login
 * rate limit is also sized against.
 */
const TRIVIAL_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "abc123",
  "letmein",
  "iloveyou",
  "admin",
  "welcome",
  "welcome1",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "trustno1",
  "passw0rd",
]);

/**
 * 10 characters, not 8. Eight is below every current guideline and the cost of
 * the extra two is one line of copy, paid once, at signup.
 *
 * No composition rules (no "must contain a symbol"): they demonstrably push
 * people toward `Password1!` and are the reason that string is in the list
 * above. Length plus a blocklist is the better-evidenced combination.
 */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200, "Password must be 200 characters or fewer")
  .refine(
    (value) => !TRIVIAL_PASSWORDS.has(value.trim().toLowerCase()),
    "That password is one of the most common in use. Please pick another.",
  );

export const dateOfBirthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Enter a valid date")
  .refine(
    (value) => new Date(`${value}T00:00:00Z`) < new Date(),
    "Date of birth must be in the past",
  );

export const signupSchema = z
  .object({
    fullName: z.string().trim().min(1, "Full name is required").max(200),
    email: z.string().trim().email("Enter a valid email address"),
    password: passwordSchema,
    // RoyalPal is 18+. See MINIMUM_AGE_YEARS and migration 0036 for why that
    // is the default and what changing it would entail.
    dateOfBirth: dateOfBirthSchema,
    role: z.enum(["student", "tutor"], {
      message: "Select whether you're signing up as a student or a tutor",
    }),
    acceptedTerms: z
      .union([z.literal("on"), z.literal("true"), z.boolean()])
      .refine((v) => v === "on" || v === "true" || v === true, {
        message: "Please accept the Terms and Privacy Policy to continue",
      }),
  })
  .superRefine((data, ctx) => {
    if (!meetsMinimumAge(data.dateOfBirth)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateOfBirth"],
        message: `You must be at least ${MINIMUM_AGE_YEARS} to use RoyalPal`,
      });
    }

    // A password that contains the account name is the first thing an
    // attacker tries once they have the email, and it survives every length
    // rule.
    const localPart = data.email.split("@")[0]?.toLowerCase() ?? "";
    if (localPart.length >= 4 && data.password.toLowerCase().includes(localPart)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: "Password must not contain your email address",
      });
    }
  });

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
});

export const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
