/**
 * Inline SVG rather than an icon package: five glyphs do not justify a
 * dependency, and a bottom tab bar is the one place where an icon that
 * arrives a frame late is obvious.
 *
 * Every icon is decorative — the tab's text label is the accessible name —
 * so they are all aria-hidden and inherit currentColor.
 */
export type NavIconName =
  | "home"
  | "search"
  | "calendar"
  | "heart"
  | "user"
  | "messages"
  | "star"
  | "clock"
  | "shield"
  | "users"
  | "card"
  | "life-ring"
  | "bell";

const PATHS: Record<NavIconName, string> = {
  home: "M3 10.5 12 3l9 7.5M5.25 9.75V20a1 1 0 0 0 1 1h3.5v-5.5h4.5V21h3.5a1 1 0 0 0 1-1V9.75",
  search: "M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm5.5-2 5 5",
  calendar:
    "M7 3v3m10-3v3M3.5 9.5h17M5 6h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 21H5a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 5 6Z",
  heart:
    "M12 20s-7.5-4.5-7.5-9.75A4.25 4.25 0 0 1 12 7.5a4.25 4.25 0 0 1 7.5 2.75C19.5 15.5 12 20 12 20Z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8.5a7 7 0 0 1 14 0",
  messages: "M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1Z",
  star: "m12 3.5 2.6 5.5 6 .85-4.35 4.2 1.05 5.95L12 17.2l-5.3 2.8 1.05-5.95L3.4 9.85l6-.85Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3.5 2",
  shield: "M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z",
  users:
    "M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 8a6 6 0 0 1 12 0m1.5-14.7a3.5 3.5 0 0 1 0 6.9M17 20a6 6 0 0 0-1.5-3.97",
  card: "M3.5 8.5h17M5 6h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 6Z",
  "life-ring":
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm2.5-6 3-3m-9 9-3 3m9 0 3 3m-9-9-3-3",
  bell: "M18 16V10.5a6 6 0 0 0-12 0V16l-2 2.5h16L18 16Zm-8 3.5a2 2 0 0 0 4 0",
};

export function NavIcon({ name, className = "" }: { name: NavIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
