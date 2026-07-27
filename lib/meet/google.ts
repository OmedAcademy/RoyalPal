import "server-only";
import {
  PermanentMeetingError,
  TransientMeetingError,
  type CreateMeetingInput,
  type Meeting,
  type MeetingProvider,
  type RescheduleMeetingInput,
} from "@/lib/meet/provider";

/**
 * Google Meet via the Calendar API.
 *
 * Auth model: one platform-owned Google account (a "RoyalPal Operations"
 * calendar) holds a long-lived refresh token; every lesson is an event on that
 * calendar with the tutor and student as attendees. That gives both parties a
 * real calendar invitation plus the Meet URL without asking every tutor to
 * complete an OAuth consent flow — the per-tutor-OAuth model would need token
 * storage, revocation handling, and a connect/disconnect UI, and is a separate
 * feature.
 *
 * Deliberately implemented with fetch rather than the googleapis SDK: the SDK
 * is a very large dependency for three endpoints, and it pulls a lot of
 * surface area into the server bundle.
 *
 * Credentials are read from the environment on the server only and are never
 * returned to callers, so nothing can leak to the client.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars";

/** Refresh a little early so a token can't expire mid-request. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

/**
 * Hard ceiling on any single Google request.
 *
 * These calls run inside the Stripe webhook. `fetch` has no default timeout,
 * so a hung Google connection would stall the webhook response until the
 * platform's function timeout, causing Stripe to treat the delivery as failed
 * and redeliver — turning a slow dependency into repeated retries of an
 * already-settled payment. Bounding the request converts that into a clean
 * transient error the service retries deliberately.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** fetch with a timeout, mapping an abort onto the retryable error type. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    // AbortError (timeout) and network failures are both worth retrying.
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new TransientMeetingError(`Google request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw new TransientMeetingError(
      `Google request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

/** Exposed for tests: clears the module-level access-token cache. */
export function __resetGoogleTokenCache(): void {
  cachedToken = null;
}

function config() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
  };
}

/** Maps HTTP status onto the retryable/permanent split the service acts on. */
function errorForStatus(status: number, body: string): Error {
  if (status === 429 || status >= 500) {
    return new TransientMeetingError(`Google API ${status}: ${body}`);
  }
  return new PermanentMeetingError(`Google API ${status}: ${body}`);
}

/**
 * Exchanges the refresh token for an access token, cached until just before
 * expiry. Refresh tokens are long-lived; access tokens last ~1h, so without
 * caching every booking would cost an extra round trip.
 */
async function getAccessToken(): Promise<string> {
  const { clientId, clientSecret, refreshToken } = config();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new PermanentMeetingError("Google credentials are not configured");
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + TOKEN_EXPIRY_MARGIN_MS) {
    return cachedToken.accessToken;
  }

  const res = await fetchWithTimeout(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    // A revoked/expired refresh token is permanent: retrying cannot fix it,
    // and the cache must not hold a bad value.
    cachedToken = null;
    throw errorForStatus(res.status, await res.text());
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

async function calendarFetch(path: string, init: RequestInit & { query?: string }) {
  const token = await getAccessToken();
  const { calendarId } = config();
  const url = `${CALENDAR_API}/${encodeURIComponent(calendarId)}/events${path}${init.query ?? ""}`;

  const res = await fetchWithTimeout(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) throw errorForStatus(res.status, await res.text());
  // DELETE returns 204 with an empty body.
  return res.status === 204 ? null : await res.json();
}

type GoogleEvent = {
  id: string;
  hangoutLink?: string;
  conferenceData?: {
    conferenceId?: string;
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
};

function toMeeting(event: GoogleEvent): Meeting {
  const videoEntry = event.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video",
  )?.uri;
  const meetingUrl = event.hangoutLink ?? videoEntry;

  if (!meetingUrl) {
    // Conference creation is asynchronous on Google's side; a missing link
    // means the event exists without a Meet room, which is not a usable
    // lesson. Treat as transient so the service retries.
    throw new TransientMeetingError("Calendar event created without a Meet link");
  }

  return {
    provider: "google_meet",
    meetingUrl,
    meetingId: event.conferenceData?.conferenceId ?? null,
    calendarEventId: event.id,
  };
}

export const googleMeetProvider: MeetingProvider = {
  name: "google_meet",

  isConfigured() {
    const { clientId, clientSecret, refreshToken } = config();
    return Boolean(clientId && clientSecret && refreshToken);
  },

  async createMeeting(input: CreateMeetingInput): Promise<Meeting> {
    const event = (await calendarFetch("", {
      method: "POST",
      // conferenceDataVersion=1 is REQUIRED for Google to honour the
      // conference create request; sendUpdates=all is what actually emails
      // the calendar invitations to tutor and student.
      query: "?conferenceDataVersion=1&sendUpdates=all",
      body: JSON.stringify({
        summary: input.subject,
        description: input.description,
        start: { dateTime: input.startAt, timeZone: input.timeZone },
        end: { dateTime: input.endAt, timeZone: input.timeZone },
        attendees: [
          { email: input.tutor.email, displayName: input.tutor.name },
          { email: input.student.email, displayName: input.student.name },
        ],
        conferenceData: {
          createRequest: {
            // Deterministic per booking: Google dedupes on requestId, so a
            // duplicate webhook cannot mint a second Meet room.
            requestId: `royalpal-${input.bookingId}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    })) as GoogleEvent;

    return toMeeting(event);
  },

  async rescheduleMeeting(input: RescheduleMeetingInput): Promise<Meeting> {
    // PATCH preserves the existing conference, so the Meet URL survives a
    // time change and previously-sent links keep working.
    const event = (await calendarFetch(`/${encodeURIComponent(input.calendarEventId)}`, {
      method: "PATCH",
      query: "?conferenceDataVersion=1&sendUpdates=all",
      body: JSON.stringify({
        start: { dateTime: input.startAt, timeZone: input.timeZone },
        end: { dateTime: input.endAt, timeZone: input.timeZone },
      }),
    })) as GoogleEvent;

    return toMeeting(event);
  },

  async cancelMeeting(calendarEventId: string): Promise<void> {
    try {
      await calendarFetch(`/${encodeURIComponent(calendarEventId)}`, {
        method: "DELETE",
        query: "?sendUpdates=all",
      });
    } catch (err) {
      // Already gone (404/410) is the desired end state, not a failure.
      if (err instanceof PermanentMeetingError && /\b(404|410)\b/.test(err.message)) return;
      throw err;
    }
  },
};
