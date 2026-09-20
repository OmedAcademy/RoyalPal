import { describe, it, expect } from "vitest";
import { createReviewSchema, replyToReviewSchema } from "@/lib/validations/review";

/**
 * REV-3 — what a rejected rating says.
 *
 * Only `min` had written copy. A 6 produced "Number must be less than or equal
 * to 5" and a 3.7 produced "Expected integer, received float" — zod's internal
 * text, in front of a student, under a star widget.
 */

const BOOKING = "44444444-4444-4444-8444-444444444444";
const REVIEW = "55555555-5555-4555-8555-555555555555";

const messageFor = (rating: unknown): string =>
  createReviewSchema.safeParse({ bookingId: BOOKING, rating, comment: "" }).error?.issues[0]
    ?.message ?? "";

/** Anything that reads as a library talking to itself. */
const INTERNAL = /expected|received|number must be|invalid_type|nan|float|integer/i;

describe("rating validation says something a person wrote", () => {
  it("explains a rating above five", async () => {
    const message = messageFor(6);

    expect(message).not.toMatch(INTERNAL);
    expect(message.length).toBeGreaterThan(0);
  });

  it("explains a fractional rating", async () => {
    const message = messageFor(3.7);

    expect(message).not.toMatch(INTERNAL);
  });

  it("explains a rating that is not a number at all", async () => {
    const message = messageFor("not a number");

    expect(message).not.toMatch(INTERNAL);
  });

  it("explains a missing rating", async () => {
    const message = messageFor(undefined);

    expect(message).not.toMatch(INTERNAL);
  });

  it("still accepts every rating a person can actually give", async () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(
        createReviewSchema.safeParse({ bookingId: BOOKING, rating, comment: "" }).success,
      ).toBe(true);
    }
  });
});

describe("reply validation", () => {
  it("explains a reply that is too long", async () => {
    const result = replyToReviewSchema.safeParse({
      reviewId: REVIEW,
      reply: "x".repeat(2001),
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message ?? "").not.toMatch(INTERNAL);
  });
});
