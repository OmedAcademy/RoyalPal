import { MemberShell } from "@/components/layout/MemberShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <MemberShell allowedRoles={["admin"]}>{children}</MemberShell>;
}
