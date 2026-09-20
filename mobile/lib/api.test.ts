import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * MOB-6 — a 401 in the middle of a session.
 *
 * `isAuthFailure` existed but was consulted only once, at bootstrap. Once the
 * app was running, an expired or revoked session turned every screen into an
 * error with a Retry button that could never work: the token is dead, so the
 * retry 401s, so the error comes back, forever. The app never signed out and
 * never routed anywhere. The only way out was to delete the app.
 *
 * Handled here rather than in each screen because there is one place every
 * screen's request goes through, and twenty places it could be forgotten.
 */

const getSession = vi.fn();
const refreshSession = vi.fn();
const signOut = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession, refreshSession, signOut } },
  isSupabaseConfigured: true,
}));

function sessionWith(token: string) {
  return { data: { session: { access_token: token } }, error: null };
}

/** Models what supabase-js really does: a successful refresh replaces the
 * session every later getSession() hands back. */
function refreshesTo(token: string) {
  refreshSession.mockImplementation(async () => {
    getSession.mockResolvedValue(sessionWith(token));
    return sessionWith(token);
  });
}

/** A fetch that replies with the given statuses in order. */
function respondWith(...statuses: number[]) {
  const calls: { token: string | undefined }[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const status = statuses[Math.min(calls.length, statuses.length - 1)];
    calls.push({
      token: (init.headers as Record<string, string>)?.Authorization?.replace("Bearer ", ""),
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(status === 401 ? { error: "Unauthorized" } : { ok: true }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("EXPO_PUBLIC_API_URL", "https://api.example.test");
  getSession.mockReset().mockResolvedValue(sessionWith("old-token"));
  refreshSession.mockReset();
  signOut.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function loadApi() {
  return import("./api");
}

describe("a 401 mid-session", () => {
  it("signs the session out instead of leaving a dead retry on screen", async () => {
    refreshSession.mockResolvedValue({ data: { session: null }, error: { message: "expired" } });
    respondWith(401);
    const { api } = await loadApi();

    await expect(api.get("/api/v1/me")).rejects.toThrow();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("reports itself as not retryable, so no screen offers a button that cannot work", async () => {
    refreshSession.mockResolvedValue({ data: { session: null }, error: { message: "expired" } });
    respondWith(401);
    const { api, ApiError } = await loadApi();

    const error = await api.get("/api/v1/me").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).isRetryable).toBe(false);
    expect((error as InstanceType<typeof ApiError>).isAuthFailure).toBe(true);
  });

  it("tries a refresh first and retries once, so a token that expired mid-flight survives", async () => {
    // The access token can expire between this request being sent and the
    // server validating it. Signing someone out for that would be its own bug.
    refreshesTo("new-token");
    const { calls } = respondWith(401, 200);
    const { api } = await loadApi();

    await expect(api.get("/api/v1/me")).resolves.toEqual({ ok: true });

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].token).toBe("new-token");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("gives up after one retry rather than looping", async () => {
    refreshesTo("new-token");
    const { calls } = respondWith(401, 401, 401);
    const { api } = await loadApi();

    await expect(api.get("/api/v1/me")).rejects.toThrow();

    expect(calls).toHaveLength(2);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("what a 401 must NOT do", () => {
  it("leaves a 500 alone — that is a retry, not a sign-out", async () => {
    respondWith(500);
    const { api, ApiError } = await loadApi();

    const error = await api.get("/api/v1/me").catch((e: unknown) => e);

    expect((error as InstanceType<typeof ApiError>).isRetryable).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("leaves a 403 alone — the session is fine, the permission is not", async () => {
    respondWith(403);
    const { api } = await loadApi();

    await expect(api.get("/api/v1/me")).rejects.toThrow();
    expect(signOut).not.toHaveBeenCalled();
  });
});
