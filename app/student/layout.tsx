import { MemberShell } from "@/components/layout/MemberShell";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <MemberShell allowedRoles={["student"]}>{children}</MemberShell>;
}
