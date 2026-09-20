import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, as, runAs, createUser, user, type Db } from "./harness";

/**
 * The admin audit log is append-only to everyone but the service role.
 *
 * An admin can change any account's role and status straight through
 * PostgREST, issue refunds and hide reviews. The log is the only record of
 * that, so an admin who can delete it can act without a trace — which is the
 * one case an audit log exists for.
 */
describe("admin_actions integrity", () => {
  let db: Db;
  let admin: string;
  let student: string;

  beforeAll(async () => {
    db = await createTestDb();
    admin = await createUser(db, "admin", "Ada Admin");
    student = await createUser(db, "student", "Sam Student");
    await db.query(`insert into public.admin_actions (admin_id, action, target_id) values ($1,'user_status:suspended',$2)`, [admin, student]);
  }, 120_000);

  afterAll(async () => { await db.close(); });

  it("refuses an admin deleting their own audit trail", async () => {
    await as(db, user(admin), async () => {
      await expect(
        db.query(`delete from public.admin_actions`),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it("refuses an admin rewriting an audit entry", async () => {
    await as(db, user(admin), async () => {
      await expect(
        db.query(`update public.admin_actions set action = 'something harmless'`),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it("refuses an admin forging an audit entry directly", async () => {
    await as(db, user(admin), async () => {
      await expect(
        db.query(`insert into public.admin_actions (admin_id, action, target_id) values ($1,'forged',$2)`, [admin, student]),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it("still lets an admin READ the log — the console depends on it", async () => {
    const rows = await runAs(db, user(admin), `select action from public.admin_actions`);
    expect(rows).toHaveLength(1);
  });

  it("still lets the service role write it — logAction depends on it", async () => {
    // Every real write goes through createAdminClient(), so this is the path
    // the application actually uses.
    const rows = await db.query(`insert into public.admin_actions (admin_id, action, target_id) values ($1,'refund',$2) returning id`, [admin, student]);
    expect(rows.rows).toHaveLength(1);
  });

  it("keeps a non-admin out entirely", async () => {
    const rows = await runAs(db, user(student), `select action from public.admin_actions`);
    expect(rows).toHaveLength(0);
  });
});
