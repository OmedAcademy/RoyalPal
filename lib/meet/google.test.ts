import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { googleMeetProvider, __resetGoogleTokenCache } from "@/lib/meet/google";
import { PermanentMeetingError, TransientMeetingError } from "@/lib/meet/provider";

/**
 * Google provider — OAuth refresh, HTTP→error mapping, and Meet-link
 * extraction. The real Calendar API is never called: fetch is mocked, so
 * these tests run without credentials and pin the contract the service
 * depends on.
 */

const CREATE_INPUT = {
  bookingId: "b-1",
  subject: "English lesson",
  startAt: "2026-08-01T10:00:00.000Z",
  endAt: "2026-08-01T11:00:00.000Z",
  timeZone: "UTC",
  tutor: { email: "tutor@example.com", name: "Ada" },
  student: { email: "student@example.com", name: "Grace" },
};

const tokenResponse = (over: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ access_token: "at_123", expires_in: 3600, ...over }), {
    status: 200,
  });

const eventResponse = (over: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: "evt_1",
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      conferenceData: { conferenceId: "abc-defg-hij" },
      ...over,
    }),
    { status: 200 },
  );

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetGoogleTokenCache();
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  process.env.GOOGLE_REFRESH_TOKEN = "rt_123";
  process.env.GOOGLE_CALENDAR_ID = "primary";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
});

describe("isConfigured", () => {
  it("is true only when all three credentials are present", () => {
    expect(googleMeetProvider.isConfigured()).toBe(true);
    delete process.env.GOOGLE_REFRESH_TOKEN;
    expect(googleMeetProvider.isConfigured()).toBe(false);
  });
});

describe("OAuth refresh", () => {
  it("exchanges the refresh token, then reuses the cached access token", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse()) // token exchange
      .mockResolvedValueOnce(eventResponse()) // create #1
      .mockResolvedValueOnce(eventResponse({ id: "evt_2" })); // create #2 (no 2nd token call)

    await googleMeetProvider.createMeeting(CREATE_INPUT);
    await googleMeetProvider.createMeeting(CREATE_INPUT);

    const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("oauth2.googleapis.com/token"),
    );
    expect(tokenCalls).toHaveLength(1);

    // The refresh-token grant was sent correctly.
    const body = tokenCalls[0][1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt_123");
  });

  it("sends the access token as a Bearer credential on the API call", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(eventResponse());

    await googleMeetProvider.createMeeting(CREATE_INPUT);

    const apiCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/calendar/v3/"));
    expect(apiCall![1].headers.Authorization).toBe("Bearer at_123");
  });

  it("treats a revoked refresh token (400) as permanent and clears the cache", async () => {
    fetchMock.mockResolvedValue(new Response("invalid_grant", { status: 400 }));

    await expect(googleMeetProvider.createMeeting(CREATE_INPUT)).rejects.toBeInstanceOf(
      PermanentMeetingError,
    );
  });

  it("refuses to operate without configured credentials", async () => {
    delete process.env.GOOGLE_REFRESH_TOKEN;
    await expect(googleMeetProvider.createMeeting(CREATE_INPUT)).rejects.toBeInstanceOf(
      PermanentMeetingError,
    );
  });
});

describe("createMeeting request shape", () => {
  it("requests a Meet conference with a deterministic per-booking requestId", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(eventResponse());

    await googleMeetProvider.createMeeting(CREATE_INPUT);

    const apiCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/calendar/v3/"));
    const url = String(apiCall![0]);
    const body = JSON.parse(apiCall![1].body as string);

    // conferenceDataVersion=1 is required for Meet; sendUpdates=all emails invites.
    expect(url).toContain("conferenceDataVersion=1");
    expect(url).toContain("sendUpdates=all");
    expect(body.conferenceData.createRequest.requestId).toBe("royalpal-b-1");
    expect(body.attendees.map((a: { email: string }) => a.email)).toEqual([
      "tutor@example.com",
      "student@example.com",
    ]);
  });

  it("returns the Meet URL, conference id and event id", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(eventResponse());

    const meeting = await googleMeetProvider.createMeeting(CREATE_INPUT);

    expect(meeting).toEqual({
      provider: "google_meet",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      meetingId: "abc-defg-hij",
      calendarEventId: "evt_1",
    });
  });

  it("maps a 5xx to a transient error (so the service retries)", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("upstream", { status: 503 }));

    await expect(googleMeetProvider.createMeeting(CREATE_INPUT)).rejects.toBeInstanceOf(
      TransientMeetingError,
    );
  });

  it("treats an event created without a Meet link as transient (conference is async)", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(eventResponse({ hangoutLink: undefined, conferenceData: {} }));

    await expect(googleMeetProvider.createMeeting(CREATE_INPUT)).rejects.toBeInstanceOf(
      TransientMeetingError,
    );
  });
});

describe("request timeouts and network failures", () => {
  it("maps a request timeout to a transient error (webhook must not hang)", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockImplementationOnce(() => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      return Promise.reject(err);
    });

    await expect(googleMeetProvider.createMeeting(CREATE_INPUT)).rejects.toBeInstanceOf(
      TransientMeetingError,
    );
  });

  it("maps a network failure to a transient error", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(googleMeetProvider.createMeeting(CREATE_INPUT)).rejects.toBeInstanceOf(
      TransientMeetingError,
    );
  });

  it("bounds every request with an abort signal", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(eventResponse());

    await googleMeetProvider.createMeeting(CREATE_INPUT);

    // Both the token exchange and the API call must carry a timeout signal.
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.signal).toBeDefined();
    }
  });
});

describe("cancelMeeting", () => {
  it("treats a 404/410 (already gone) as success", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await expect(googleMeetProvider.cancelMeeting("evt_gone")).resolves.toBeUndefined();
  });

  it("propagates a real failure (500)", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));

    await expect(googleMeetProvider.cancelMeeting("evt_1")).rejects.toBeInstanceOf(
      TransientMeetingError,
    );
  });
});
