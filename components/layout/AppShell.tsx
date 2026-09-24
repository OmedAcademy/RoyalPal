"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { NavIcon, type NavIconName } from "@/components/layout/NavIcon";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  /** Shown in the bottom tab bar on phones. Everything else lives in the
   * "More" sheet, because more than five tabs stops being a tab bar. */
  primary?: boolean;
  badge?: number;
};

/**
 * The authenticated application shell.
 *
 * Phones get a bottom tab bar (five items) plus a More sheet for the rest.
 * Tablets and desktops get a left sidebar with every destination, so a
 * 768px iPad is not a stretched phone and Saved / Settings / Support are
 * not hidden until a desktop breakpoint.
 */
export function AppShell({
  areaLabel,
  items,
  children,
  headerRight,
}: {
  areaLabel: string;
  items: NavItem[];
  children: ReactNode;
  headerRight?: ReactNode;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = items.filter((item) => item.primary).slice(0, 4);
  const overflow = items.filter((item) => !primary.includes(item));

  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  function itemClass(active: boolean, layout: "side" | "tab") {
    if (layout === "side") {
      return `flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${
        active ? "bg-[color:var(--hairline)] text-foreground" : "text-muted hover:text-foreground"
      }`;
    }
    return `relative flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium ${
      active ? "text-royal" : "text-muted"
    }`;
  }

  function Badge({ count }: { count: number }) {
    return (
      <span className="bg-royal text-royal-contrast min-w-4 rounded-full px-1 text-[10px] leading-4 font-semibold">
        {count > 9 ? "9+" : count}
      </span>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="border-hairline bg-surface sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r px-3 py-4 md:flex">
        <Link href={items[0]?.href ?? "/"} className="px-3 pb-4">
          <span className="font-display text-lg font-semibold tracking-tight">
            Royal<span className="text-royal">Pal</span>
          </span>
          <span className="text-muted mt-0.5 block text-xs">{areaLabel}</span>
        </Link>
        <nav aria-label={`${areaLabel} sections`} className="flex flex-1 flex-col gap-1">
          {items.map((item) => {
            const active = activeHref === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={itemClass(active, "side")}
              >
                <NavIcon name={item.icon} className="h-5 w-5 shrink-0" />
                <span className="truncate">{item.label}</span>
                {item.badge ? <Badge count={item.badge} /> : null}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-hairline bg-surface sticky top-0 z-40 border-b">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Link
              href={items[0]?.href ?? "/"}
              className="flex min-w-0 items-center gap-2 md:hidden"
            >
              <span className="font-display truncate font-semibold tracking-tight">
                Royal<span className="text-royal">Pal</span>
              </span>
              <span className="text-muted text-sm">{areaLabel}</span>
            </Link>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">{headerRight}</div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-24 sm:px-6 md:pb-10">
          {children}
        </main>

        <nav
          aria-label={`${areaLabel} primary`}
          className="border-hairline bg-surface fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          <ul className="mx-auto flex max-w-lg items-stretch">
            {primary.map((item) => {
              const active = activeHref === item.href;
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={itemClass(active, "tab")}
                  >
                    <span className="relative">
                      <NavIcon name={item.icon} className="h-5 w-5" />
                      {item.badge ? (
                        <span className="absolute -top-1 -right-2">
                          <Badge count={item.badge} />
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
            {overflow.length > 0 ? (
              <li className="flex-1">
                <button
                  type="button"
                  aria-expanded={moreOpen}
                  aria-controls="app-more"
                  onClick={() => setMoreOpen((open) => !open)}
                  className="text-muted relative flex min-h-[3.25rem] w-full flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium"
                >
                  <NavIcon name="shield" className="h-5 w-5" />
                  <span>More</span>
                </button>
              </li>
            ) : null}
          </ul>
        </nav>

        {moreOpen ? (
          <div
            id="app-more"
            className="border-hairline bg-surface fixed inset-x-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom))] z-40 border-t p-3 md:hidden"
          >
            <ul className="mx-auto grid max-w-lg grid-cols-2 gap-2">
              {overflow.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={activeHref === item.href ? "page" : undefined}
                    onClick={() => setMoreOpen(false)}
                    className={itemClass(activeHref === item.href, "side")}
                  >
                    <NavIcon name={item.icon} className="h-5 w-5" />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
