import { MemberShell } from "@/components/layout/MemberShell";

/**
 * Messages, settings and support are the same product for every role, so they
 * live in one route group behind one layout rather than being duplicated under
 * /student and /tutor. MemberShell renders the VIEWER's own navigation, so a
 * tutor opening /messages keeps the tutor tab bar.
 */
export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return <MemberShell allowedRoles={["student", "tutor", "admin"]}>{children}</MemberShell>;
}
