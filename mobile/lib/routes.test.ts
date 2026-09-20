import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { toMobileRoute, type ViewerRole } from "./routes";

/**
 * MOB-2 and MOB-3.
 *
 * Notifications carry a web href. The app pushed it straight into the router,
 * which either showed expo-router's "Unmatched Route" developer screen to a
 * real person, or — for `/tutor/profile` and `/tutor/payouts` — matched the
 * dynamic `tutor/[id]` route and produced a 500 from a uuid cast.
 *
 * The routes are read off the filesystem rather than listed here, so adding a
 * screen or renaming one keeps this honest instead of agreeing with a copy
 * that has drifted.
 */

// `.pathname` rather than fileURLToPath: this file is typechecked by the
// Expo tsconfig, whose DOM URL type is not the node one.
const APP_DIR = new URL("../app", import.meta.url).pathname;

/** Every route the app really has, as expo-router would derive them. */
function mobileRoutes(): string[] {
  const routes: string[] = [];

  function walk(dir: string, prefix: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, `${prefix}/${entry}`);
        continue;
      }
      if (!entry.endsWith(".tsx")) continue;
      const name = entry.replace(/\.tsx$/, "");
      if (name === "_layout" || name.startsWith("+")) continue;
      routes.push(name === "index" ? prefix || "/" : `${prefix}/${name}`);
    }
  }

  walk(APP_DIR, "");
  return routes;
}

const ROUTES = mobileRoutes();

/** A dynamic segment matches any one segment; a group is optional in a href. */
function routeExists(path: string): boolean {
  const wanted = path.split("/").filter(Boolean);

  return ROUTES.some((route) => {
    const actual = route.split("/").filter(Boolean);
    // A route group contributes nothing to the URL, so a href may include it
    // (to disambiguate two tabs of the same name) or leave it out.
    const withoutGroups = actual.filter((s) => !s.startsWith("("));
    return matches(wanted, actual) || matches(wanted, withoutGroups);
  });

  function matches(want: string[], have: string[]): boolean {
    if (want.length !== have.length) return false;
    return have.every((segment, i) =>
      segment.startsWith("[") && segment.endsWith("]") ? true : segment === want[i],
    );
  }
}

/**
 * Every href the server puts in a notification's `data.href`, gathered from
 * `grep -rn "data: { href" lib app` on the web side.
 */
const EMITTED_HREFS = [
  "/student/bookings",
  "/tutor/bookings",
  "/tutor/dashboard",
  "/tutor/profile",
  "/tutor/payouts",
  "/settings/account",
  "/support/77777777-7777-4777-8777-777777777777",
  "/messages/88888888-8888-4888-8888-888888888888",
  "/admin/delivery",
  "/admin/support/77777777-7777-4777-8777-777777777777",
];

const ROLES: ViewerRole[] = ["student", "tutor", "admin"];

describe("the route table this test reads", () => {
  it("found the app's real routes", () => {
    // Guards the rest of the file: an empty list would make every assertion
    // below pass for the wrong reason.
    expect(ROUTES.length).toBeGreaterThan(10);
    expect(routeExists("/notifications")).toBe(true);
    expect(routeExists("/tutor/88888888-8888-4888-8888-888888888888")).toBe(true);
  });
});

describe("toMobileRoute — every notification lands somewhere real (MOB-2)", () => {
  for (const role of ROLES) {
    it(`resolves or declines every emitted href for a ${role}`, () => {
      for (const href of EMITTED_HREFS) {
        const target = toMobileRoute(href, role);
        if (target === null) continue; // no destination in this app, so no push
        expect(routeExists(target), `${href} -> ${target} is not a route`).toBe(true);
      }
    });
  }

  it("sends a lesson notification to the right role's lessons tab", () => {
    expect(toMobileRoute("/student/bookings", "student")).toBe("/(student)/lessons");
    expect(toMobileRoute("/tutor/bookings", "tutor")).toBe("/(tutor)/lessons");
  });

  it("declines an admin link rather than pushing one", () => {
    // There is no admin surface in this app. Not navigating is the honest
    // answer; the alternative is the unmatched-route screen.
    expect(toMobileRoute("/admin/support/abc", "admin")).toBeNull();
    expect(toMobileRoute("/admin/delivery", "admin")).toBeNull();
  });

  it("keeps ids that both sides spell the same way", () => {
    expect(toMobileRoute("/messages/abc", "student")).toBe("/messages/abc");
    expect(toMobileRoute("/support/abc", "tutor")).toBe("/support/abc");
  });

  it("ignores a query string and a trailing slash", () => {
    expect(toMobileRoute("/student/bookings?from=email", "student")).toBe("/(student)/lessons");
    expect(toMobileRoute("/student/bookings/", "student")).toBe("/(student)/lessons");
  });

  it("declines an absolute URL and an empty href", () => {
    expect(toMobileRoute("https://royalpal.com/student/bookings", "student")).toBeNull();
    expect(toMobileRoute("", "student")).toBeNull();
    expect(toMobileRoute(null, "student")).toBeNull();
  });
});

describe("toMobileRoute — the collision that 500s (MOB-3)", () => {
  it("never sends /tutor/profile into the dynamic tutor route", () => {
    // tutor/[id] matches "profile", the screen asks the API for tutor
    // "profile", and Postgres refuses the uuid cast. A plausible screen that
    // fails is worse than one that is plainly missing.
    const target = toMobileRoute("/tutor/profile", "tutor");
    expect(target).toBe("/(tutor)/profile");
    expect(target).not.toBe("/tutor/profile");
  });

  it("never sends /tutor/payouts into it either", () => {
    expect(toMobileRoute("/tutor/payouts", "tutor")).toBe("/(tutor)/profile");
  });

  it("still routes a real tutor id to the tutor screen", () => {
    const id = "99999999-9999-4999-8999-999999999999";
    expect(toMobileRoute(`/tutor/${id}`, "student")).toBe(`/tutor/${id}`);
  });
});
