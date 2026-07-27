import { listAuditLog } from "@/lib/supabase/admin-data";
import { AdminTable, Th, Td } from "@/components/admin/AdminTable";
import { formatDateTime } from "@/lib/utils/format";

export default async function AdminAuditPage() {
  const entries = await listAuditLog();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Audit log</h1>
      <p className="text-muted -mt-2 text-sm">
        Every privileged admin action (tutor verification, account status changes) is recorded here.
      </p>

      <AdminTable
        isEmpty={entries.length === 0}
        empty="No admin actions recorded yet."
        head={
          <>
            <Th>Action</Th>
            <Th>Admin</Th>
            <Th>Target</Th>
            <Th>When</Th>
          </>
        }
      >
        {entries.map((e) => (
          <tr key={e.id}>
            <Td className="font-medium">{e.action}</Td>
            <Td className="text-muted">{e.admin_name}</Td>
            <Td className="text-muted font-mono text-xs">{e.target_id ?? "—"}</Td>
            <Td className="text-muted whitespace-nowrap">{formatDateTime(e.created_at)}</Td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
