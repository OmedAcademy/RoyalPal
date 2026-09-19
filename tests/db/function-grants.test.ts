import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, as, runAs, serviceRole, user, type Db } from "./harness";

/**
 * Who can call the functions in this schema.
 *
 * Postgres grants EXECUTE on every new function to PUBLIC by default, and
 * PostgREST publishes anything `anon` or `authenticated` can execute at
 * /rest/v1/rpc/<name> — reachable with the anon key that ships in the web
 * bundle and in both mobile binaries. So a function is exposed to the whole
 * internet unless a migration says otherwise, and "we never granted it" is not
 * a defence. Both findings below were written with a comment asserting a
 * protection that the database did not actually have.
 */
describe("function grants", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  async function executable(role: string, fn: string): Promise<boolean> {
    const result = await db.query<{ granted: boolean }>(
      `select bool_or(has_function_privilege($1, p.oid, 'EXECUTE')) as granted
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $2`,
      [role, fn],
    );
    return result.rows[0]?.granted ?? false;
  }

  describe("consume_rate_limit", () => {
    it("is not executable by anon or authenticated", async () => {
      expect(await executable("anon", "consume_rate_limit")).toBe(false);
      expect(await executable("authenticated", "consume_rate_limit")).toBe(false);
    });

    it("is executable by the service role, which is the only caller", async () => {
      expect(await executable("service_role", "consume_rate_limit")).toBe(true);
    });

    it("refuses a signed-in caller", async () => {
      await expect(
        runAs(
          db,
          user("11111111-1111-1111-1111-111111111111"),
          `select * from public.consume_rate_limit('login:probe', 5, 60)`,
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it("cannot be used to lock another account out of signing in", async () => {
      // The attack this closes. The key is `<policy>:<sha256(identifier)[0:40]>`
      // with no salt (lib/rate-limit/limiter.ts), so a victim's login key is
      // computable from their email address alone. Before the revoke, the six
      // calls below ran happily and left `allowed` false for the real owner.
      const victimKey = `login:${"a".repeat(40)}`;
      await as(db, user("11111111-1111-1111-1111-111111111111"), async () => {
        await expect(
          db.query(`select * from public.consume_rate_limit($1, 5, 60)`, [victimKey]),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });

  describe("reschedule_booking", () => {
    it("is not executable by anon or authenticated", async () => {
      expect(await executable("anon", "reschedule_booking")).toBe(false);
      expect(await executable("authenticated", "reschedule_booking")).toBe(false);
    });

    it("is executable by the service role", async () => {
      expect(await executable("service_role", "reschedule_booking")).toBe(true);
    });

    it("refuses a signed-in caller before any of its own checks run", async () => {
      // "permission denied" rather than "booking not found": the caller never
      // reaches the function body, so p_max_reschedules => 9999 is moot.
      await expect(
        runAs(
          db,
          user("11111111-1111-1111-1111-111111111111"),
          `select public.reschedule_booking($1, now() + interval '2 days', null, 9999)`,
          ["22222222-2222-2222-2222-222222222222"],
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it("leaves the service role able to call it", async () => {
      await expect(
        runAs(db, serviceRole, `select public.reschedule_booking($1, now() + interval '2 days')`, [
          "22222222-2222-2222-2222-222222222222",
        ]),
      ).rejects.toThrow(/booking not found/i);
    });
  });

  /**
   * The general invariant, so the next function added does not have to be
   * found by a human reading grants.
   *
   * Trigger functions are excluded: PostgREST does not expose a function
   * returning `trigger`, and calling one directly raises before it does
   * anything. Extension-owned functions (pgcrypto, btree_gist) are excluded
   * because their grants are not this project's to manage.
   */
  it("exposes no application function to clients except the allowlisted ones", async () => {
    const ALLOWED = new Set([
      // Every RLS policy in this schema calls it, and a policy runs as the
      // querying role — so it must stay callable. It reads only the caller's
      // own profile row and returns a boolean.
      "is_admin",
    ]);

    const result = await db.query<{ proname: string; role: string }>(
      `select p.proname, r.rolname as role
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         cross join (select unnest(array['anon','authenticated']) as rolname) r
        where n.nspname = 'public'
          and pg_get_function_result(p.oid) <> 'trigger'
          and not exists (
            select 1 from pg_depend d
             where d.objid = p.oid and d.deptype = 'e'
          )
          and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
        order by p.proname, r.rolname`,
    );

    const unexpected = result.rows
      .filter((row) => !ALLOWED.has(row.proname))
      .map((row) => `${row.proname} (executable by ${row.role})`);

    expect(
      unexpected,
      "revoke EXECUTE from public, anon and authenticated, or allowlist it here with a reason",
    ).toEqual([]);
  });
});
