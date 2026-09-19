import { MemberShell } from "@/components/layout/MemberShell";

export default function TutorLayout({ children }: { children: React.ReactNode }) {
  return <MemberShell allowedRoles={["tutor"]}>{children}</MemberShell>;
}
