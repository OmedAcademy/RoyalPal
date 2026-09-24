import { describe, expect, it } from "vitest";
import { pathRequiresSession } from "@/lib/supabase/middleware";

describe("pathRequiresSession", () => {
  it("leaves the marketing and auth pages open", () => {
    for (const path of [
      "/",
      "/login",
      "/signup",
      "/forgot-password",
      "/legal/terms",
      "/our-impact",
    ]) {
      expect(pathRequiresSession(path), path).toBe(false);
    }
  });

  it("closes role areas and the shared authenticated routes", () => {
    for (const path of [
      "/student/dashboard",
      "/tutor/bookings",
      "/admin",
      "/admin/tutors",
      "/messages",
      "/messages/abc",
      "/settings",
      "/settings/account",
      "/support",
      "/support/abc",
    ]) {
      expect(pathRequiresSession(path), path).toBe(true);
    }
  });
});
