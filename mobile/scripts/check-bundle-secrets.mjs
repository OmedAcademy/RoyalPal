#!/usr/bin/env node
/**
 * Fails if a shipped bundle contains anything that looks like a server secret.
 *
 * A rule nobody can check is a rule that holds until the first hurried commit.
 * `EXPO_PUBLIC_` is the only prefix Expo inlines, so the usual mistake is not
 * adding a secret with that prefix — it is importing a server module into a
 * screen and dragging a literal along with it, which type-checks, bundles
 * cleanly, and ships. This reads the real Hermes bytecode Metro produced.
 *
 * Usage: node scripts/check-bundle-secrets.mjs [dist-dir]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "dist";

/** Patterns that must never appear in a client binary. */
const FORBIDDEN = [
  { label: "Supabase service-role key name", pattern: /SUPABASE_SERVICE_ROLE/ },
  // A service-role JWT carries this role claim; base64 of `"role":"service_role"`
  // is checked too, since the key ships as a compact JWT rather than as text.
  { label: "service_role literal", pattern: /service_role/ },
  // A Supabase service-role key is a compact JWT, so the literal above never
  // appears — the claim is base64url inside the payload. Which encoding you
  // get depends on the claim's byte offset, so all three alignments of
  // `"service_role"` are checked.
  // A Supabase service-role key is a compact JWT, so the literal above never
  // appears — the claim is base64url inside the payload, and which characters
  // you get depends on the claim's byte offset. These are the three stable
  // alignments of `service_role`, verified against 200 generated payloads.
  {
    label: "service_role claim inside a JWT",
    pattern: /(c2VydmljZV9yb2xl|cnZpY2Vfcm9s|ZXJ2aWNlX3Jv)/,
  },
  { label: "Stripe secret key", pattern: /sk_(live|test)_[A-Za-z0-9]{8}/ },
  { label: "Stripe restricted key", pattern: /rk_(live|test)_[A-Za-z0-9]{8}/ },
  { label: "Stripe webhook secret", pattern: /whsec_[A-Za-z0-9]{8}/ },
  // Deliberately the env-var NAME, not a key shape. Hermes packs its string
  // table contiguously, so short prefixes like `re_` match the seam between
  // two unrelated identifiers — a scanner that cries wolf gets switched off.
  { label: "Resend API key name", pattern: /RESEND_API_KEY/ },
  { label: "Google OAuth client secret", pattern: /GOCSPX-/ },
  { label: "Cron secret name", pattern: /CRON_SECRET/ },
  { label: "Expo access token name", pattern: /EXPO_ACCESS_TOKEN/ },
  { label: "PEM private key", pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

let scanned = 0;
const findings = [];

try {
  statSync(root);
} catch {
  console.error(`No bundle at ${root}. Run \`npx expo export\` first.`);
  process.exit(2);
}

for (const file of walk(root)) {
  // Read as latin1 so bytecode is searchable as text without decode errors.
  const contents = readFileSync(file, "latin1");
  scanned += 1;
  for (const { label, pattern } of FORBIDDEN) {
    if (pattern.test(contents)) findings.push({ file, label });
  }
}

if (findings.length > 0) {
  console.error(`\nSECRETS FOUND IN THE BUNDLE — this must not ship:\n`);
  for (const finding of findings) console.error(`  ${finding.label}  →  ${finding.file}`);
  console.error(
    `\nNothing privileged belongs in a client binary. Move the operation behind` +
      ` an /api/v1 route and let the server hold the credential.\n`,
  );
  process.exit(1);
}

console.log(`No server secrets found in ${scanned} bundled file(s) under ${root}/.`);
