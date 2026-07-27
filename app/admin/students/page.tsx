import { listUsers } from "@/lib/supabase/admin-data";
import { AdminTable, Th, Td } from "@/components/admin/AdminTable";
import { UserStatusButton } from "@/components/admin/UserStatusButton";
import { formatDate } from "@/lib/utils/format";

export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const students = await listUsers({ role: "student", search: q });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Student management</h1>
        <form method="get">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by name"
            className="border-hairline-strong bg-surface focus:border-royal rounded-full border px-3.5 py-1.5 text-sm focus:outline-none"
          />
        </form>
      </div>

      <AdminTable
        isEmpty={students.length === 0}
        empty="No students match this view."
        head={
          <>
            <Th>Name</Th>
            <Th>Country</Th>
            <Th>Status</Th>
            <Th>Joined</Th>
            <Th>Actions</Th>
          </>
        }
      >
        {students.map((u) => (
          <tr key={u.id}>
            <Td className="font-medium">{u.full_name}</Td>
            <Td className="text-muted">{u.country ?? "—"}</Td>
            <Td>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  u.status === "suspended"
                    ? "bg-red-100 text-red-700"
                    : "bg-emerald-100 text-emerald-800"
                }`}
              >
                {u.status}
              </span>
            </Td>
            <Td className="text-muted whitespace-nowrap">{formatDate(u.created_at)}</Td>
            <Td>
              <UserStatusButton userId={u.id} status={u.status} />
            </Td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
