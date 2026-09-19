import type { Metadata } from "next";
import Link from "next/link";
import { runDiagnostics, type CheckStatus } from "@/lib/diagnostics";

export const metadata: Metadata = { title: "Diagnostics — RoyalPal admin" };

// Every answer here is about the state of the world right now. A cached one
// would be worse than none: it would report the configuration as it was at
// build time, which is exactly the moment before anyone changed it.
export const dynamic = "force-dynamic";

const BADGE: Record<CheckStatus, { icon: string; label: string; className: string }> = {
  green: { icon: "✅", label: "OK", className: "text-emerald-700" },
  yellow: { icon: "⚪", label: "Not configured", className: "text-amber-700" },
  red: { icon: "⛔", label: "Needs attention", className: "text-red-700" },
};

export default async function AdminDiagnosticsPage() {
  const report = await runDiagnostics();

  const groups = report.checks.reduce<Record<string, typeof report.checks>>((acc, check) => {
    (acc[check.group] ??= []).push(check);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Diagnostics</h1>
        <p className="text-muted max-w-2xl text-sm">
          What this deployment can actually do, checked against the running database, the live
          configuration and its own public pages — not against what a document says.
        </p>
      </div>

      <div
        className={`border-hairline rounded-2xl border p-5 ${report.ok ? "bg-surface" : "bg-red-50"}`}
      >
        <p className="text-lg font-semibold">
          {report.ok
            ? report.counts.yellow === 0
              ? "Everything checked is configured and verified."
              : `Nothing is broken. ${report.counts.yellow} thing${report.counts.yellow === 1 ? " is" : "s are"} intentionally not configured yet.`
            : `${report.counts.red} check${report.counts.red === 1 ? "" : "s"} need${report.counts.red === 1 ? "s" : ""} attention.`}
        </p>
        <p className="text-muted mt-1 text-sm">
          {report.counts.green} OK · {report.counts.yellow} not configured · {report.counts.red}{" "}
          needs attention · checked {new Date(report.ranAt).toUTCString()}
        </p>
        <p className="text-muted mt-3 text-sm">
          <strong>Not configured</strong> is not a fault. Stripe, email and Google Meet are each
          dormant by design until their credentials exist, and the app degrades honestly without
          them. <strong>Needs attention</strong> means something is broken or unsafe.
        </p>
      </div>

      {Object.entries(groups).map(([group, checks]) => (
        <section key={group} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{group}</h2>
          <ul className="flex flex-col gap-2">
            {checks.map((check) => {
              const badge = BADGE[check.status];
              return (
                <li
                  key={check.id}
                  className="border-hairline bg-surface flex flex-col gap-1 rounded-xl border p-4"
                >
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    <span aria-hidden="true">{badge.icon}</span>
                    <span>{check.label}</span>
                    <span className={`text-xs font-normal ${badge.className}`}>{badge.label}</span>
                  </span>
                  <span className="text-muted text-sm">{check.detail}</span>
                  {check.remedy ? (
                    <span className="text-sm">
                      <span className="font-medium">To fix: </span>
                      <span className="text-muted">{check.remedy}</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="text-muted text-sm">
        Notification channels have their own page, where you can send yourself a real test:{" "}
        <Link href="/admin/delivery" className="text-royal font-medium hover:underline">
          Admin → Delivery
        </Link>
        .
      </p>
    </div>
  );
}
