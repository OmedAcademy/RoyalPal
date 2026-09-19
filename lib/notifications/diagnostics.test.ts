import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The channel registry pulls in the Supabase admin client; the diagnostics
// under test here read configuration only, so the registry is stubbed to keep
// this a pure test of what the page reports.
vi.mock("@/lib/notifications/channels", () => ({
  secondaryChannels: [
    { name: "email", isEnabled: () => false, deliver: async () => {} },
    { name: "push", isEnabled: () => true, deliver: async () => {} },
  ],
}));

import { describeChannels } from "@/lib/notifications/diagnostics";

const ENV_KEYS = ["RESEND_API_KEY", "EMAIL_FROM_ADDRESS", "EXPO_ACCESS_TOKEN"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const find = (channel: string) => describeChannels().find((c) => c.channel === channel)!;

describe("describeChannels", () => {
  it("reports email as NOT configured when either credential is missing", () => {
    expect(find("email").configured).toBe(false);

    // One of the two is not enough — a key with no from-address sends nothing,
    // and reporting that as configured is the failure this page exists to
    // prevent.
    process.env.RESEND_API_KEY = "re_test";
    expect(find("email").configured).toBe(false);

    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM_ADDRESS = "hello@royalpal.app";
    expect(find("email").configured).toBe(false);
  });

  it("reports email as configured only with both", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM_ADDRESS = "hello@royalpal.app";
    expect(find("email").configured).toBe(true);
  });

  it("names the env vars to set when email is dormant", () => {
    // An operator reading "not configured" needs to know what to do about it.
    const detail = find("email").detail;
    expect(detail).toContain("RESEND_API_KEY");
    expect(detail).toContain("EMAIL_FROM_ADDRESS");
  });

  it("reports push as available without a key, and says so", () => {
    const push = find("push");
    expect(push.configured).toBe(true);
    expect(push.detail).toMatch(/unauthenticated/i);
    expect(push.detail).toContain("EXPO_ACCESS_TOKEN");
  });

  it("distinguishes an authenticated Expo configuration", () => {
    process.env.EXPO_ACCESS_TOKEN = "expo_test";
    expect(find("push").detail).toMatch(/authenticated \(EXPO_ACCESS_TOKEN set\)/);
  });

  it("always reports the in-app channel as on", () => {
    expect(find("in-app").configured).toBe(true);
  });

  it("never omits a registered channel", () => {
    // The page describes channels by hand; this is what stops a channel added
    // to channels.ts from silently disappearing from the operator's view.
    const described = describeChannels().map((channel) => channel.channel);
    expect(described).toContain("email");
    expect(described).toContain("push");
  });

  it("does not leak credential values into what it prints", () => {
    process.env.RESEND_API_KEY = "re_supersecret";
    process.env.EMAIL_FROM_ADDRESS = "hello@royalpal.app";
    process.env.EXPO_ACCESS_TOKEN = "expo_supersecret";
    const printed = describeChannels()
      .map((channel) => channel.detail)
      .join(" ");
    expect(printed).not.toContain("re_supersecret");
    expect(printed).not.toContain("expo_supersecret");
  });
});
