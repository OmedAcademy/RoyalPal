/**
 * One-time helper: mint a long-lived Google refresh token for the RoyalPal
 * operations account.
 *
 *   node scripts/google-refresh-token.mjs
 *
 * Run this ONCE, signed in as the platform's own Google account (not a
 * tutor's and not a student's). The resulting refresh token goes in
 * GOOGLE_REFRESH_TOKEN; after that the server refreshes access tokens
 * automatically and no human ever logs in again.
 *
 * Why a script and not an in-app OAuth route: RoyalPal authenticates users
 * with Supabase email/password, so the app has no Google OAuth flow and
 * shouldn't grow one just to hold a single platform credential.
 *
 * Requires in .env.local: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 * GOOGLE_REDIRECT_URI (must match the Google Cloud console exactly).
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { URL } from "node:url";

/**
 * Writes GOOGLE_REFRESH_TOKEN straight into .env.local (replacing any existing
 * value) instead of printing it. Keeps the credential out of terminal
 * scrollback, shell history, and any transcript of this session.
 */
function persistRefreshToken(token) {
  const line = `GOOGLE_REFRESH_TOKEN=${token}`;
  let contents = "";
  try {
    contents = readFileSync(".env.local", "utf8");
  } catch {
    /* file will be created */
  }

  const updated = /^GOOGLE_REFRESH_TOKEN=.*$/m.test(contents)
    ? contents.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, line)
    : contents.replace(/\s*$/, "\n") + line + "\n";

  writeFileSync(".env.local", updated, "utf8");
}

// Minimal .env.local reader — avoids a dependency for a one-shot script.
function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* no .env.local — rely on the ambient environment */
  }
}
loadEnv();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/oauth2callback";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env.local");
  process.exit(1);
}

const redirect = new URL(REDIRECT_URI);
const port = Number(redirect.port || 80);

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    // access_type=offline + prompt=consent is what actually returns a refresh
    // token. Without prompt=consent Google omits it on repeat authorizations.
    access_type: "offline",
    prompt: "consent",
  });

console.log("\n1. Open this URL while signed in as the RoyalPal ops account:\n");
console.log(authUrl);
console.log(`\n2. Waiting for the redirect on ${REDIRECT_URI} ...\n`);

const server = createServer(async (req, res) => {
  const code = new URL(req.url, `http://localhost:${port}`).searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("No authorization code in callback.");
    return;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const json = await tokenRes.json();

  if (!tokenRes.ok || !json.refresh_token) {
    res.writeHead(500).end("Token exchange failed — see terminal.");
    console.error("\nToken exchange failed:", json);
    console.error(
      "\nIf refresh_token is absent, revoke prior access at " +
        "https://myaccount.google.com/permissions and retry.",
    );
    server.close();
    process.exit(1);
  }

  res
    .writeHead(200, { "Content-Type": "text/html" })
    .end("<h2>RoyalPal: refresh token captured.</h2><p>Return to your terminal.</p>");

  persistRefreshToken(json.refresh_token);

  // The token itself is deliberately NOT printed — only proof it was stored.
  console.log("SUCCESS: GOOGLE_REFRESH_TOKEN written to .env.local");
  console.log(
    `         (${json.refresh_token.length} characters, starts "${json.refresh_token.slice(0, 6)}…")`,
  );
  console.log("\nNext: node scripts/google-verify.mjs");
  console.log("Remember to add the same value to your Vercel environment.\n");
  server.close();
  process.exit(0);
});

server.listen(port);
