"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/actions/notifications";
import type { NotificationDTO } from "@/lib/notifications/types";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function groupOf(iso: string): "Today" | "Yesterday" | "Earlier" {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startToday) return "Today";
  if (t >= startToday - 86_400_000) return "Yesterday";
  return "Earlier";
}

const GROUP_ORDER = ["Today", "Yesterday", "Earlier"] as const;

export function NotificationCenter({
  notifications,
  unreadCount,
}: {
  notifications: NotificationDTO[];
  unreadCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function openItem(n: NotificationDTO) {
    startTransition(async () => {
      if (!n.read) await markNotificationRead(n.id);
      router.refresh();
      if (n.href) {
        setOpen(false);
        router.push(n.href);
      }
    });
  }

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  }

  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    items: notifications.filter((n) => groupOf(n.createdAt) === g),
  })).filter((g) => g.items.length > 0);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        className="text-foreground relative inline-grid h-10 w-10 place-items-center rounded-full transition-colors hover:bg-[color:var(--hairline)]"
      >
        <span aria-hidden="true" className="text-lg">
          🔔
        </span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[color:var(--gold-rich)] px-1 text-[11px] font-semibold text-[#2a2109]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="shadow-luxe-lg border-hairline bg-surface absolute right-0 z-50 mt-2 w-[min(92vw,24rem)] overflow-hidden rounded-2xl border"
        >
          <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
            <p className="font-display text-base font-semibold">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="text-royal text-xs font-medium hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p aria-hidden="true" className="text-2xl">
                  ✦
                </p>
                <p className="text-muted mt-2 text-sm">You&apos;re all caught up.</p>
              </div>
            ) : (
              grouped.map(({ group, items }) => (
                <div key={group}>
                  <p className="text-muted bg-[color:var(--hairline)]/40 px-4 py-1.5 text-xs font-semibold tracking-wide uppercase">
                    {group}
                  </p>
                  <ul>
                    {items.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => openItem(n)}
                          className={`border-hairline flex w-full gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-[color:var(--hairline)]/40 ${
                            n.read
                              ? ""
                              : "bg-[color:color-mix(in_srgb,var(--royal)_5%,transparent)]"
                          }`}
                        >
                          <span aria-hidden="true" className="mt-0.5 text-lg">
                            {n.icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{n.title}</span>
                              {!n.read && (
                                <span
                                  aria-label="unread"
                                  className="h-2 w-2 shrink-0 rounded-full bg-[color:var(--gold-rich)]"
                                />
                              )}
                            </span>
                            {n.body && (
                              <span className="text-muted mt-0.5 block text-xs">{n.body}</span>
                            )}
                            <span className="text-muted mt-1 block text-[11px]">
                              {relativeTime(n.createdAt)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
