import type { UserRole } from "@/types/database";

/**
 * Single source of truth for where each role lands after login/signup/
 * email confirmation. Used by the login action, the auth callback route,
 * and middleware, so the mapping can't drift between them.
 */
export function roleToDashboardPath(role: UserRole): string {
  switch (role) {
    case "student":
      return "/student/dashboard";
    case "tutor":
      return "/tutor/dashboard";
    case "admin":
      return "/admin";
  }
}
