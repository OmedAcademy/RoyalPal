"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
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
 * WHY THIS EXISTS
 * Each of the three areas used to render its own header: a single flex row of
 * text links with no wrapping and no mobile treatment. At 375px the student
 * header had four links, a notification bell and a sign-out button competing
 * for about 300 usable pixels, and the result was unusable on exactly the
 * devices most tutoring traffic comes from.
 *
 * The shape is the one every marketplace converges on for good reason:
 *   - phones get a bottom tab bar, within thumb reach, five items maximum,
 *     with anything else behind "More"
 *   - tablets and desktops get the horizontal bar back, since there is room
 *     and a bottom bar wastes vertical space on a pointer device
 *
 * `pb-[env(safe-area-inset-bottom)]` is not decoration: without it the tab bar
 * sits under the home indicator on an iPhone and the last few pixels of every
 * tap land on the system gesture area instead of the button.
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
  const primary = items.filter((item) => item.primary).slice(0, 5);

  // Longest-prefix match, so /student/tutors/abc/book highlights "Search"
  // rather than nothing, and /student/dashboard does not light up every tab
  // whose href is a prefix of it.
  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-hairline bg-surface sticky top-0 z-40 border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href={items[0]?.href ?? "/"} className="flex min-w-0 items-center gap-2">
            <span className="font-display truncate font-semibold tracking-tight">
              Royal<span className="text-royal">Pal</span>
            </span>
            <span className="text-muted hidden text-sm sm:inline">{areaLabel}</span>
          </Link>

          <nav aria-label={`${areaLabel} sections`} className="hidden items-center gap-1 lg:flex">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={activeHref === item.href ? "page" : undefined}
                className={`relative rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                  activeHref === item.href
                    ? "text-foreground bg-[color:var(--hairline)]"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {item.label}
                {item.badge ? (
                  <span className="bg-royal text-royal-contrast absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-[10px] leading-4 font-semibold">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5">{headerRight}</div>
        </div>
      </header>

      {/* pb-20 on phones reserves the height of the fixed tab bar so the last
          element on a page is never trapped behind it. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-24 sm:px-6 lg:pb-10">
        {children}
      </main>

      <nav
        aria-label={`${areaLabel} primary`}
        className="border-hairline bg-surface fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch">
          {primary.map((item) => {
            const active = activeHref === item.href;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors ${
                    active ? "text-royal" : "text-muted"
                  }`}
                >
                  <span className="relative">
                    <NavIcon name={item.icon} className="h-5 w-5" />
                    {item.badge ? (
                      <span className="bg-royal text-royal-contrast absolute -top-1 -right-2 min-w-4 rounded-full px-1 text-[10px] leading-4 font-semibold">
                        {item.badge > 9 ? "9+" : item.badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
