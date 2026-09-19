import { MemberShell } from "@/components/layout/MemberShell";

/**
 * Support gets its own layout, outside the (member) group, for one reason:
 * allowSuspended. A suspended account is cut off from everything else and
 * must still be able to ask why.
 */
export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return (
    <MemberShell allowedRoles={["student", "tutor", "admin"]} allowSuspended>
      {children}
    </MemberShell>
  );
}
