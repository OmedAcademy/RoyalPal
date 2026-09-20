import { describe, it, expect } from "vitest";
import { navigationFor } from "@/lib/navigation";

/**
 * SUP-7 — the support badge.
 *
 * `openTicketCount()` existed and had no callers: the badge it was written for
 * was never wired up, so an admin had to open the queue to learn there was
 * anything in it. The count of things waiting on you is the whole reason a
 * queue has a badge.
 */

const supportItem = (items: ReturnType<typeof navigationFor>) =>
  items.find((i) => i.href === "/admin/support");

describe("navigationFor — the admin support badge", () => {
  it("shows the number of tickets waiting on an admin", () => {
    expect(supportItem(navigationFor("admin", { openTickets: 4 }))?.badge).toBe(4);
  });

  it("carries no badge when the queue is empty", () => {
    // Not a zero. A badge reading 0 is a thing to dismiss rather than read.
    expect(supportItem(navigationFor("admin", { openTickets: 0 }))?.badge).toBeFalsy();
  });

  it("carries no badge when the count was not loaded", () => {
    expect(supportItem(navigationFor("admin"))?.badge).toBeFalsy();
  });

  it("still badges messages for a student, unchanged", () => {
    const messages = navigationFor("student", { unreadMessages: 3 }).find(
      (i) => i.href === "/messages",
    );
    expect(messages?.badge).toBe(3);
  });
});
