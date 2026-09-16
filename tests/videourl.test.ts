import { describe, it, expect } from "vitest";
import { tutorProfileSchema } from "@/lib/validations/profile";
import { isSafeHttpUrl, safeExternalUrl } from "@/lib/utils/url";

/**
 * Stored-XSS regression.
 *
 * `z.string().url()` accepts any scheme the URL parser understands, including
 * `javascript:` and `data:`. tutor_profiles.video_url is rendered into an
 * <a href> on the PUBLIC tutor page, so accepting those schemes let an
 * approved tutor run arbitrary JavaScript in this origin for every student
 * who clicked "Watch intro video".
 */

const DANGEROUS = [
  "javascript:alert(document.cookie)",
  "JaVaScRiPt:alert(1)", // case-variant must not bypass
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
];

const SAFE = ["https://youtube.com/watch?v=abc", "http://example.com/intro.mp4"];

const baseProfile = {
  fullName: "T",
  headline: "h",
  bio: "b",
  languagesSpoken: ["English"],
  teachingLanguages: ["English"],
  specializations: [],
  yearsExperience: "",
  certifications: [],
  education: "",
  hourlyPrice: "10",
  trialPrice: "",
  availabilityNote: "",
  subjectIds: [],
  country: "",
  timezone: "UTC",
};

describe("isSafeHttpUrl", () => {
  for (const v of DANGEROUS) {
    it(`rejects ${JSON.stringify(v.slice(0, 26))}`, () => expect(isSafeHttpUrl(v)).toBe(false));
  }
  for (const v of SAFE) {
    it(`accepts ${v}`, () => expect(isSafeHttpUrl(v)).toBe(true));
  }
});

describe("safeExternalUrl (render boundary — protects pre-existing rows)", () => {
  it("nulls out a hostile value already stored in the database", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
  });

  it("passes through a safe value", () => {
    expect(safeExternalUrl("https://example.com")).toBe("https://example.com");
  });

  it("handles null and empty", () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
  });
});

describe("tutorProfileSchema.videoUrl (write boundary)", () => {
  for (const v of DANGEROUS) {
    it(`refuses to store ${JSON.stringify(v.slice(0, 26))}`, () => {
      expect(tutorProfileSchema.safeParse({ ...baseProfile, videoUrl: v }).success).toBe(false);
    });
  }

  it("accepts a normal https video link", () => {
    expect(tutorProfileSchema.safeParse({ ...baseProfile, videoUrl: SAFE[0] }).success).toBe(true);
  });

  it("still allows the field to be left blank", () => {
    expect(tutorProfileSchema.safeParse({ ...baseProfile, videoUrl: "" }).success).toBe(true);
  });
});
