import { describe, it, expect } from "vitest";
import { signupSchema, updatePasswordSchema, passwordSchema } from "@/lib/validations/auth";

const validSignup = {
  fullName: "Sam Student",
  email: "sam@example.com",
  password: "correct-horse-battery",
  dateOfBirth: "1995-04-02",
  role: "student" as const,
  acceptedTerms: "on" as const,
};

describe("passwordSchema", () => {
  it("requires 10 characters", () => {
    expect(passwordSchema.safeParse("nine char").success).toBe(false);
    expect(passwordSchema.safeParse("ten chars!").success).toBe(true);
  });

  it("rejects the passwords a stuffing run tries first, case-insensitively", () => {
    for (const trivial of ["password123", "PASSWORD123", "  qwertyuiop  ", "1234567890"]) {
      expect(passwordSchema.safeParse(trivial).success, trivial).toBe(false);
    }
  });
});

describe("signupSchema", () => {
  it("accepts a well-formed adult signup", () => {
    expect(signupSchema.safeParse(validSignup).success).toBe(true);
  });

  it("refuses someone under the minimum age", () => {
    const result = signupSchema.safeParse({ ...validSignup, dateOfBirth: "2019-01-01" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("dateOfBirth"))).toBe(true);
    }
  });

  it("refuses a missing or unchecked terms box", () => {
    expect(signupSchema.safeParse({ ...validSignup, acceptedTerms: undefined }).success).toBe(
      false,
    );
    expect(signupSchema.safeParse({ ...validSignup, acceptedTerms: false }).success).toBe(false);
  });

  it("refuses a password containing the email local part", () => {
    const result = signupSchema.safeParse({
      ...validSignup,
      email: "jonathan@example.com",
      password: "jonathan-is-great",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("password"))).toBe(true);
    }
  });

  it("does not reject on a coincidentally short local part", () => {
    // "sam" is 3 characters — below the threshold, because otherwise any
    // password containing a common 3-letter string would be refused.
    expect(
      signupSchema.safeParse({ ...validSignup, email: "sam@example.com", password: "samsonite-x1" })
        .success,
    ).toBe(true);
  });

  it("refuses an admin role even though the enum would have to allow it", () => {
    expect(signupSchema.safeParse({ ...validSignup, role: "admin" }).success).toBe(false);
  });
});

describe("updatePasswordSchema", () => {
  it("requires the confirmation to match", () => {
    expect(
      updatePasswordSchema.safeParse({ password: "ten chars!", confirmPassword: "ten chars?" })
        .success,
    ).toBe(false);
    expect(
      updatePasswordSchema.safeParse({ password: "ten chars!", confirmPassword: "ten chars!" })
        .success,
    ).toBe(true);
  });
});
