import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/**
 * Real-Postgres harness for RLS, trigger and grant tests.
 *
 * Why this exists alongside tests/helpers/fake-supabase.ts: the fake proves
 * how Server Actions branch, but this project's security invariants live in
 * Postgres — policies, triggers, grants — and the fake can evaluate none of
 * them. It stays green while a student PATCHes themselves to admin.
 *
 * PGlite is real Postgres compiled to WASM, in-process. Each test file gets
 * its own in-memory database with EVERY migration in supabase/migrations
 * applied on top of supabase-shim.sql. Nothing persists, and nothing here
 * can reach a remote database.
 *
 * What it does not cover: the PostgREST HTTP layer and GoTrue. `as()` puts
 * the connection into the same state PostgREST does for a request — SET ROLE
 * plus request.jwt.claims — so policies and triggers see exactly what they
 * see in production, but the request itself is SQL rather than HTTP.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, "../../supabase/migrations");
const SHIM = path.join(HERE, "supabase-shim.sql");

export type Db = PGlite;
export type Row = Record<string, unknown>;

export async function createTestDb(): Promise<Db> {
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  await db.exec(readFileSync(SHIM, "utf8"));

  // DB_TEST_MAX_MIGRATION=28 builds the schema as it stood before 0029, so an
  // attack can be shown to succeed before its fix lands. Unset = every file.
  const maxMigration = Number(process.env.DB_TEST_MAX_MIGRATION ?? Number.POSITIVE_INFINITY);
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file) && Number(file.slice(0, 4)) <= maxMigration)
    .sort();
  for (const file of migrations) {
    try {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    } catch (err) {
      throw new Error(`migration ${file} failed to apply: ${(err as Error).message}`);
    }
  }
  return db;
}

export type Actor = { kind: "user"; id: string } | { kind: "service_role" } | { kind: "postgres" };

/** A signed-in client: PostgREST's `authenticated` role with this user's JWT. */
export const user = (id: string): Actor => ({ kind: "user", id });
/** The service-role client: webhooks and admin Server Actions. */
export const serviceRole: Actor = { kind: "service_role" };
/** No role switch: the SQL editor, and how SECURITY DEFINER functions run. */
export const postgres: Actor = { kind: "postgres" };

/**
 * Runs `fn` as `actor` inside a transaction that is ALWAYS rolled back, so
 * every test starts from the same fixture and an allowed write can never
 * leak into the next test. Assert on a write's effect inside `fn`.
 */
export async function as<T>(db: Db, actor: Actor, fn: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    if (actor.kind !== "postgres") {
      const role = actor.kind === "user" ? "authenticated" : "service_role";
      const claims = actor.kind === "user" ? { sub: actor.id, role } : { role };
      await db.exec(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    }
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}

/** Runs a statement as `actor` and returns its rows. */
export async function runAs<T = Row>(
  db: Db,
  actor: Actor,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return as(db, actor, async () => (await db.query<T>(sql, params)).rows);
}

/**
 * Asserts a statement was refused with SQLSTATE 42501 AND the expected
 * message. The message is not optional: RLS WITH CHECK violations also raise
 * 42501, and a security test must not pass for the wrong reason.
 */
export async function expectDenied(attempt: Promise<unknown>, message: RegExp): Promise<void> {
  let caught: unknown;
  try {
    await attempt;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the statement to be refused, but it succeeded").toBeDefined();
  expect(caught).toMatchObject({ code: "42501" });
  expect((caught as Error).message).toMatch(message);
}

/**
 * Creates an account through auth.users, so handle_new_user builds the
 * profile exactly as a real signup does. Admins cannot self-register, so an
 * admin signs up as a tutor and is promoted in SQL — the path the README
 * documents.
 */
export async function createUser(
  db: Db,
  role: "student" | "tutor" | "admin",
  fullName: string,
): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    `${id}@test.royalpal.local`,
    JSON.stringify({ role: role === "admin" ? "tutor" : role, full_name: fullName }),
  ]);
  if (role === "admin") {
    await db.query("update public.profiles set role = 'admin' where id = $1", [id]);
  }
  return id;
}

export type TutorSeed = {
  verification_status?: "pending" | "approved" | "rejected";
  stripe_account_id?: string | null;
  stripe_charges_enabled?: boolean;
  stripe_payouts_enabled?: boolean;
  stripe_details_submitted?: boolean;
  stripe_requirements_due?: string[];
  stripe_disabled_reason?: string | null;
  platform_fee_bps?: number | null;
};

/** Seeds a tutor_profiles row as a trusted writer, with any platform state. */
export async function createTutorProfile(db: Db, id: string, seed: TutorSeed = {}): Promise<void> {
  await db.query(
    `insert into public.tutor_profiles (
       id, headline, bio, hourly_rate_cents, verification_status, stripe_account_id,
       stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted,
       stripe_requirements_due, stripe_disabled_reason, platform_fee_bps
     ) values ($1, 'Seeded headline', 'Seeded bio', 5000, $2, $3, $4, $5, $6, $7::text[], $8, $9)`,
    [
      id,
      seed.verification_status ?? "pending",
      seed.stripe_account_id ?? null,
      seed.stripe_charges_enabled ?? false,
      seed.stripe_payouts_enabled ?? false,
      seed.stripe_details_submitted ?? false,
      seed.stripe_requirements_due ?? [],
      seed.stripe_disabled_reason ?? null,
      seed.platform_fee_bps ?? null,
    ],
  );
}

/** Reads a row as a trusted writer, bypassing RLS, to check committed state. */
export async function readRow(db: Db, table: string, id: string): Promise<Row | undefined> {
  const { rows } = await db.query<Row>(`select * from public.${table} where id = $1`, [id]);
  return rows[0];
}
