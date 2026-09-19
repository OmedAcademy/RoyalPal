import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  createUser,
  expectDenied,
  postgres,
  readRow,
  runAs,
  serviceRole,
  user,
  type Db,
} from "@/tests/db/harness";

/**
 * Migration 0027 — profiles.role and profiles.status are platform-controlled.
 *
 * The attack being closed: RLS scopes profiles writes to the caller's own
 * ROW, not its columns, so any signed-in user holding their own session
 * token could PATCH /rest/v1/profiles directly and set role = 'admin' — after
 * which every `or is_admin()` policy and authorizeAdmin() let them in — or
 * lift their own suspension. Each statement below runs with the role and JWT
 * claims PostgREST would use for that caller, against real Postgres with
 * every migration applied.
 */

const ROLE_OR_STATUS_CHANGE = /only an admin can change profiles\.role or profiles\.status/;
const PRIVILEGED_INSERT = /profiles\.role and profiles\.status are platform-controlled/;

let db: Db;
let student: string;
let tutor: string;
let admin: string;
let suspended: string;

beforeAll(async () => {
  db = await createTestDb();
  student = await createUser(db, "student", "Sam Student");
  tutor = await createUser(db, "tutor", "Tia Tutor");
  admin = await createUser(db, "admin", "Ada Admin");
  suspended = await createUser(db, "student", "Sid Suspended");
  await db.query("update public.profiles set status = 'suspended' where id = $1", [suspended]);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("a user cannot make themselves admin", () => {
  it("refuses a student setting their own role to admin, and is_admin() stays false", async () => {
    await expectDenied(
      runAs(db, user(student), "update public.profiles set role = 'admin' where id = $1", [
        student,
      ]),
      ROLE_OR_STATUS_CHANGE,
    );

    expect((await readRow(db, "profiles", student))?.role).toBe("student");
    // The consequence that matters: every admin RLS policy keys off this.
    const [check] = await runAs<{ is_admin: boolean }>(
      db,
      user(student),
      "select public.is_admin() as is_admin",
    );
    expect(check.is_admin).toBe(false);
  });

  it("refuses a tutor changing their own role in either direction", async () => {
    for (const role of ["admin", "student"]) {
      await expectDenied(
        runAs(db, user(tutor), "update public.profiles set role = $2 where id = $1", [tutor, role]),
        ROLE_OR_STATUS_CHANGE,
      );
    }
    expect((await readRow(db, "profiles", tutor))?.role).toBe("tutor");
  });

  it("refuses the escalation even when it rides along with a legitimate field", async () => {
    // The whole statement must fail — not apply the name change and quietly
    // skip the role.
    await expectDenied(
      runAs(
        db,
        user(student),
        "update public.profiles set full_name = 'Innocent Edit', role = 'admin' where id = $1",
        [student],
      ),
      ROLE_OR_STATUS_CHANGE,
    );

    const row = await readRow(db, "profiles", student);
    expect(row?.role).toBe("student");
    expect(row?.full_name).toBe("Sam Student");
  });

  it("refuses an account with no profile row inserting one as admin or with a forced status", async () => {
    // Accounts created before handle_new_user (0012) existed can lack a
    // profiles row, and profiles_insert_own would otherwise let them create
    // one with any role.
    const orphan = await createUser(db, "student", "Orphan Account");
    await db.query("delete from public.profiles where id = $1", [orphan]);

    await expectDenied(
      runAs(
        db,
        user(orphan),
        "insert into public.profiles (id, role, full_name) values ($1, 'admin', 'Orphan')",
        [orphan],
      ),
      PRIVILEGED_INSERT,
    );
    await expectDenied(
      runAs(
        db,
        user(orphan),
        "insert into public.profiles (id, role, full_name, status) values ($1, 'student', 'Orphan', 'suspended')",
        [orphan],
      ),
      PRIVILEGED_INSERT,
    );

    // The guard is scoped to the privileged values, not to inserting at all.
    const inserted = await runAs(
      db,
      user(orphan),
      "insert into public.profiles (id, role, full_name) values ($1, 'student', 'Orphan') returning role, status",
      [orphan],
    );
    expect(inserted).toEqual([{ role: "student", status: "active" }]);
  });
});

describe("a user cannot change their own account status", () => {
  it("refuses a user changing their own status", async () => {
    await expectDenied(
      runAs(db, user(student), "update public.profiles set status = 'suspended' where id = $1", [
        student,
      ]),
      ROLE_OR_STATUS_CHANGE,
    );
    expect((await readRow(db, "profiles", student))?.status).toBe("active");
  });

  it("refuses a suspended user lifting their own suspension", async () => {
    // Suspension does not revoke the session, so this user still holds a
    // valid token — exactly the position the attack starts from.
    await expectDenied(
      runAs(db, user(suspended), "update public.profiles set status = 'active' where id = $1", [
        suspended,
      ]),
      ROLE_OR_STATUS_CHANGE,
    );
    expect((await readRow(db, "profiles", suspended))?.status).toBe("suspended");
  });
});

describe("legitimate profile updates still work", () => {
  // `phone` is written but NOT returned. Migration 0041 revokes SELECT on it
  // from `authenticated`, so a RETURNING clause naming it makes the whole
  // statement fail with "permission denied for column" — the write is still
  // allowed, the read-back is not. The asymmetry is deliberate and is asserted
  // on its own below.
  const SELF_SERVICE_UPDATE = `
    update public.profiles
    set full_name = $2, country = $3, timezone = $4, phone = $5, avatar_url = $6
    where id = $1
    returning full_name, country, timezone, avatar_url, role, status`;

  it("lets a student update every self-service field", async () => {
    const rows = await runAs(db, user(student), SELF_SERVICE_UPDATE, [
      student,
      "Sam Updated",
      "Ireland",
      "Europe/Dublin",
      "+353 1 000 0000",
      "https://example.test/avatars/sam.png",
    ]);

    expect(rows).toEqual([
      {
        full_name: "Sam Updated",
        country: "Ireland",
        timezone: "Europe/Dublin",
        avatar_url: "https://example.test/avatars/sam.png",
        role: "student",
        status: "active",
      },
    ]);
  });

  it("lets a tutor update every self-service field", async () => {
    const rows = await runAs(db, user(tutor), SELF_SERVICE_UPDATE, [
      tutor,
      "Tia Updated",
      "United Kingdom",
      "Europe/London",
      null,
      null,
    ]);

    expect(rows).toEqual([
      {
        full_name: "Tia Updated",
        country: "United Kingdom",
        timezone: "Europe/London",
        avatar_url: null,
        role: "tutor",
        status: "active",
      },
    ]);
  });

  it("does not treat re-sending the unchanged role and status as a change", async () => {
    // A full-row writer must keep working as long as it does not ALTER them.
    const rows = await runAs(
      db,
      user(student),
      "update public.profiles set full_name = 'Same Role', role = 'student', status = 'active' where id = $1 returning full_name",
      [student],
    );
    expect(rows).toEqual([{ full_name: "Same Role" }]);
  });

  it("still creates the profile and student profile at signup", async () => {
    const fresh = await createUser(db, "student", "Fresh Signup");

    expect(await readRow(db, "profiles", fresh)).toMatchObject({
      role: "student",
      status: "active",
      full_name: "Fresh Signup",
    });
    expect(await readRow(db, "student_profiles", fresh)).toBeDefined();
  });
});

describe("trusted writers can still manage role and status", () => {
  it("lets an admin suspend another user and change their role", async () => {
    const rows = await runAs(
      db,
      user(admin),
      "update public.profiles set status = 'suspended', role = 'tutor' where id = $1 returning status, role",
      [student],
    );
    expect(rows).toEqual([{ status: "suspended", role: "tutor" }]);
  });

  it("lets the service role change status and role — the setUserStatus path", async () => {
    const rows = await runAs(
      db,
      serviceRole,
      "update public.profiles set status = 'active', role = 'student' where id = $1 returning status, role",
      [suspended],
    );
    expect(rows).toEqual([{ status: "active", role: "student" }]);
  });

  it("lets the SQL editor promote an admin, as the README documents", async () => {
    const rows = await runAs(
      db,
      postgres,
      "update public.profiles set role = 'admin' where id = $1 returning role",
      [tutor],
    );
    expect(rows).toEqual([{ role: "admin" }]);
  });
});
