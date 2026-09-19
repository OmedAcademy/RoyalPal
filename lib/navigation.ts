import type { NavItem } from "@/components/layout/AppShell";
import type { UserRole } from "@/types/database";

/**
 * One source of truth for the authenticated navigation of each role.
 *
 * It lives outside the layouts because /messages, /settings and /support are
 * shared routes that any signed-in role can reach, and their layout has to
 * render the SAME navigation the user had a moment ago. Without this, walking
 * from the student dashboard into Messages would swap the tab bar out from
 * under them.
 *
 * `primary` marks the five that get a bottom tab on phones. Five is the
 * ceiling: past that the targets fall below a comfortable touch size on a
 * 360px device, and a tab bar you have to aim at is worse than a menu.
 */
export function navigationFor(role: UserRole, counts: { unreadMessages?: number } = {}): NavItem[] {
  const messages: NavItem = {
    href: "/messages",
    label: "Messages",
    icon: "messages",
    primary: true,
    badge: counts.unreadMessages,
  };

  if (role === "student") {
    return [
      { href: "/student/dashboard", label: "Home", icon: "home", primary: true },
      { href: "/student/tutors", label: "Find", icon: "search", primary: true },
      { href: "/student/bookings", label: "Lessons", icon: "calendar", primary: true },
      messages,
      { href: "/student/favorites", label: "Saved", icon: "heart" },
      { href: "/student/profile", label: "Profile", icon: "user", primary: true },
      { href: "/settings", label: "Settings", icon: "shield" },
      { href: "/support", label: "Support", icon: "life-ring" },
    ];
  }

  if (role === "tutor") {
    return [
      { href: "/tutor/dashboard", label: "Home", icon: "home", primary: true },
      { href: "/tutor/availability", label: "Calendar", icon: "clock", primary: true },
      { href: "/tutor/bookings", label: "Lessons", icon: "calendar", primary: true },
      messages,
      { href: "/tutor/reviews", label: "Reviews", icon: "star" },
      { href: "/tutor/payouts", label: "Payouts", icon: "card" },
      { href: "/tutor/profile", label: "Profile", icon: "user", primary: true },
      { href: "/settings", label: "Settings", icon: "shield" },
      { href: "/support", label: "Support", icon: "life-ring" },
    ];
  }

  return [
    { href: "/admin", label: "Overview", icon: "home", primary: true },
    { href: "/admin/tutors", label: "Tutors", icon: "users", primary: true },
    { href: "/admin/students", label: "Students", icon: "user" },
    { href: "/admin/bookings", label: "Lessons", icon: "calendar", primary: true },
    { href: "/admin/payments", label: "Payments", icon: "card" },
    { href: "/admin/reviews", label: "Reviews", icon: "star" },
    { href: "/admin/support", label: "Support", icon: "life-ring", primary: true },
    { href: "/admin/audit", label: "Audit", icon: "shield", primary: true },
  ];
}

/** Where a role's "home" is, used by the shell's logo link. */
export function homeFor(role: UserRole): string {
  if (role === "student") return "/student/dashboard";
  if (role === "tutor") return "/tutor/dashboard";
  return "/admin";
}
