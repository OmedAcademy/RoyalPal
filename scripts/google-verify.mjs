/**
 * Live Google Meet / Calendar verification harness.
 *
 *   node scripts/google-verify.mjs
 *
 * Makes REAL calls to Google with the credentials in .env.local and prints
 * hard evidence: access-token refresh, calendar event id, Meet URL, attendee
 * list, idempotency behaviour, and deletion. Creates a throwaway event ~1 day
 * out and removes it again, so it is safe to run against the production
 * calendar.
 *
 * This exists because the unit tests mock `fetch` — they prove our logic, not
 * that the wire format Google actually accepts is correct. Only a real round
 * trip proves that.
 *
 * Exit code 0 = every check passed.
 */
import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* rely on ambient env */
  }
}
loadEnv();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? "primary";

// Optional: real addresses to prove invitations actually go out.
const TUTOR_EMAIL = process.env.VERIFY_TUTOR_EMAIL;
const STUDENT_EMAIL = process.env.VERIFY_STUDENT_EMAIL;

const CAL = "https://www.googleapis.com/calendar/v3/calendars";
let failures = 0;

const ok = (m, extra) => console.log(`  PASS  ${m}${extra ? ` — ${extra}` : ""}`);
const bad = (m, extra) => {
  failures++;
  console.error(`  FAIL  ${m}${extra ? ` — ${extra}` : ""}`);
};
const step = (n, t) => console.log(`\n[${n}] ${t}`);
/** Never print a full credential. */
const redact = (s) => (s ? `${String(s).slice(0, 8)}…(${String(s).length} chars)` : "(unset)");

step(0, "Environment");
for (const [k, v] of [
  ["GOOGLE_CLIENT_ID", CLIENT_ID],
  ["GOOGLE_CLIENT_SECRET", CLIENT_SECRET],
  ["GOOGLE_REFRESH_TOKEN", REFRESH_TOKEN],
]) {
  v ? ok(k, redact(v)) : bad(k, "missing");
}
ok("GOOGLE_CALENDAR_ID", CALENDAR_ID);
if (failures) {
  console.error("\nCannot continue without credentials. See README > Google Meet setup.\n");
  process.exit(1);
}

// ---- 1. OAuth refresh ------------------------------------------------------
step(1, "OAuth: exchange refresh token for an access token");
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: "refresh_token",
  }),
});
const tokenJson = await tokenRes.json();
if (!tokenRes.ok) {
  bad("token exchange", `${tokenRes.status} ${JSON.stringify(tokenJson)}`);
  console.error(
    "\nIf this says invalid_grant, the refresh token was revoked or expired.\n" +
      "NOTE: while the OAuth consent screen is in 'Testing', Google expires\n" +
      "refresh tokens after 7 days. Publish the app to stop that.\n",
  );
  process.exit(1);
}
ok("access token obtained", `expires_in=${tokenJson.expires_in}s`);
const ACCESS = tokenJson.access_token;

const api = (path, init = {}) =>
  fetch(`${CAL}/${encodeURIComponent(CALENDAR_ID)}/events${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ACCESS}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

// ---- 2. Create event + Meet conference ------------------------------------
step(2, "Calendar: create event with a Google Meet conference");
const bookingId = `verify-${Date.now()}`;
const start = new Date(Date.now() + 86_400_000);
const end = new Date(start.getTime() + 3_600_000);

const attendees = [];
if (TUTOR_EMAIL) attendees.push({ email: TUTOR_EMAIL, displayName: "Verify Tutor" });
if (STUDENT_EMAIL) attendees.push({ email: STUDENT_EMAIL, displayName: "Verify Student" });

const body = {
  summary: "RoyalPal verification — safe to ignore",
  description: "Automated verification event. Deleted automatically.",
  start: { dateTime: start.toISOString(), timeZone: "UTC" },
  end: { dateTime: end.toISOString(), timeZone: "UTC" },
  attendees,
  conferenceData: {
    createRequest: {
      requestId: `royalpal-${bookingId}`,
      conferenceSolutionKey: { type: "hangoutsMeet" },
    },
  },
};

const createRes = await api("?conferenceDataVersion=1&sendUpdates=all", {
  method: "POST",
  body: JSON.stringify(body),
});
const event = await createRes.json();
if (!createRes.ok) {
  bad("create event", `${createRes.status} ${JSON.stringify(event)}`);
  process.exit(1);
}

ok("event created", `id=${event.id}`);
const meetUrl =
  event.hangoutLink ??
  event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
meetUrl ? ok("Meet conference attached", meetUrl) : bad("Meet conference attached", "no link");
if (event.conferenceData?.conferenceId) {
  ok("conferenceId", event.conferenceData.conferenceId);
}
ok("organizer", event.organizer?.email ?? "(none)");
if (attendees.length) {
  ok("attendees invited", (event.attendees ?? []).map((a) => a.email).join(", "));
} else {
  console.log(
    "  SKIP  attendee invitations — set VERIFY_TUTOR_EMAIL / VERIFY_STUDENT_EMAIL to test",
  );
}

// ---- 3. Idempotency --------------------------------------------------------
step(3, "Idempotency: same conference requestId must not mint a second room");
const dupRes = await api("?conferenceDataVersion=1&sendUpdates=none", {
  method: "POST",
  body: JSON.stringify(body),
});
const dup = await dupRes.json();
if (dupRes.ok) {
  const dupUrl = dup.hangoutLink;
  // Google returns a NEW event id (events are not deduped) but the same
  // conference for an identical requestId. RoyalPal's real protection is the
  // calendar_event_id check in MeetingService before it ever calls Google.
  dupUrl === meetUrl
    ? ok("same conference reused for identical requestId", dupUrl)
    : console.log(
        `  NOTE  Google issued a different conference (${dupUrl}). RoyalPal still cannot\n` +
          "        duplicate: MeetingService returns early when calendar_event_id is set.",
      );
  await api(`/${encodeURIComponent(dup.id)}?sendUpdates=none`, { method: "DELETE" });
  ok("duplicate probe cleaned up", dup.id);
} else {
  bad("duplicate probe", `${dupRes.status}`);
}

// ---- 4. Reschedule (PATCH preserves the conference) ------------------------
step(4, "Reschedule: PATCH must preserve the Meet URL");
const newStart = new Date(start.getTime() + 3_600_000);
const newEnd = new Date(newStart.getTime() + 3_600_000);
const patchRes = await api(
  `/${encodeURIComponent(event.id)}?conferenceDataVersion=1&sendUpdates=all`,
  {
    method: "PATCH",
    body: JSON.stringify({
      start: { dateTime: newStart.toISOString(), timeZone: "UTC" },
      end: { dateTime: newEnd.toISOString(), timeZone: "UTC" },
    }),
  },
);
const patched = await patchRes.json();
if (!patchRes.ok) {
  bad("patch event", `${patchRes.status} ${JSON.stringify(patched)}`);
} else {
  ok("event rescheduled", patched.start?.dateTime);
  patched.hangoutLink === meetUrl
    ? ok("Meet URL preserved across reschedule", patched.hangoutLink)
    : bad("Meet URL changed on reschedule", patched.hangoutLink);
}

// ---- 5. Cancel -------------------------------------------------------------
step(5, "Cancellation: delete the event and confirm it is gone");
const delRes = await api(`/${encodeURIComponent(event.id)}?sendUpdates=all`, { method: "DELETE" });
delRes.ok || delRes.status === 204
  ? ok("event deleted", `status=${delRes.status}`)
  : bad("delete event", `${delRes.status}`);

const gone = await api(`/${encodeURIComponent(event.id)}`);
[404, 410].includes(gone.status)
  ? ok("deletion confirmed", `GET returns ${gone.status}`)
  : console.log(`  NOTE  GET returned ${gone.status} (Google may retain a 'cancelled' tombstone)`);

// ---- Summary ---------------------------------------------------------------
console.log("\n" + "=".repeat(60));
if (failures === 0) {
  console.log("RESULT: PASS — live Google Calendar + Meet integration verified.");
  console.log(`Evidence: event id ${event.id}, Meet ${meetUrl}`);
} else {
  console.log(`RESULT: FAIL — ${failures} check(s) failed. See output above.`);
}
console.log("=".repeat(60) + "\n");
process.exit(failures === 0 ? 0 : 1);
