import { describe, it, expect, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => new Headers(),
}));

const { invokeAction, actionResponse, apiError } = await import("@/lib/api/handler");

/**
 * invokeAction is the adapter that lets the mobile API reuse the web's Server
 * Actions instead of reimplementing them. The subtle part is redirect: an
 * action that succeeds by calling redirect() THROWS, and the destination is
 * the result. Getting that wrong turns a successful booking into a 500.
 */
describe("invokeAction", () => {
  const initial = {} as { error?: string; message?: string };

  it("returns the action's state when it returns normally", async () => {
    const action = vi.fn(async () => ({ message: "done" }));
    const result = await invokeAction(action, { a: "1" }, initial);

    expect(result).toEqual({ state: { message: "done" } });
    const formData = action.mock.calls[0][1] as FormData;
    expect(formData.get("a")).toBe("1");
  });

  it("stringifies numbers and drops null/undefined, like a real form post", async () => {
    const action = vi.fn(async () => ({}));
    await invokeAction(action, { n: 60, empty: null, missing: undefined, s: "x" }, initial);

    const formData = action.mock.calls[0][1] as FormData;
    expect(formData.get("n")).toBe("60");
    expect(formData.get("s")).toBe("x");
    // Absent rather than the string "null", which a zod schema would then
    // happily accept as a value.
    expect(formData.has("empty")).toBe(false);
    expect(formData.has("missing")).toBe(false);
  });

  it("extracts the destination from a thrown redirect carrying `url`", async () => {
    const action = vi.fn(async () => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { url: "https://checkout.test/session" });
    });

    expect(await invokeAction(action, {}, initial)).toEqual({
      redirectTo: "https://checkout.test/session",
    });
  });

  it("extracts it from Next's `digest` form too", async () => {
    // The shape Next actually throws in a route handler:
    // "NEXT_REDIRECT;replace;<url>;307;"
    const action = vi.fn(async () => {
      throw Object.assign(new Error("redirect"), {
        digest: "NEXT_REDIRECT;replace;/support/abc-123;307;",
      });
    });

    expect(await invokeAction(action, {}, initial)).toEqual({ redirectTo: "/support/abc-123" });
  });

  it("re-throws anything that is not a redirect", async () => {
    const action = vi.fn(async () => {
      throw new Error("database is on fire");
    });

    await expect(invokeAction(action, {}, initial)).rejects.toThrow("database is on fire");
  });
});

describe("actionResponse", () => {
  it("maps a refusal to 422, not 500 or 400", async () => {
    // 422 says "understood, and refused on its merits" — a taken slot, a
    // policy rule. Authentication and authorization have their own codes and
    // never arrive here.
    const response = actionResponse({ error: "That time was just booked" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "That time was just booked", code: "rejected" });
  });

  it("maps success to 200 with the message", async () => {
    const response = actionResponse({ message: "Lesson cancelled." });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: "Lesson cancelled." });
  });

  it("carries no message rather than inventing one", async () => {
    expect(await actionResponse({}).json()).toEqual({ ok: true, message: null });
  });
});

describe("apiError", () => {
  it("never leaks internals, only the message it was given", async () => {
    const response = apiError("Sign in to continue", 401, "unauthenticated");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Sign in to continue",
      code: "unauthenticated",
    });
  });
});
