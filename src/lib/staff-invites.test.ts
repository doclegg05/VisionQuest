import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { MAX_PASSWORD_LENGTH } from "@/lib/password-policy";
import { createFakeDb, type Row, type TableName } from "@/lib/staff-invite-test-db";

// Staff invites against an in-memory stand-in for Postgres
// (`staff-invite-test-db.ts`). Only `@/lib/db` is mocked: org-roles, region
// and the module under test all run for real.
const fake = createFakeDb();

mock.module("@/lib/db", {
  exports: { prisma: fake.client, prismaAdmin: fake.client },
});

let lib: typeof import("./staff-invites");

before(async () => {
  lib = await import("./staff-invites");
});

const admin: Session = { id: "admin-1", studentId: "admin", displayName: "Admin", role: "admin" };
const programCoordinator: Session = {
  id: "pc-1",
  studentId: "pc",
  displayName: "Program Coordinator",
  role: "program_coordinator",
};
const regionalCoordinator: Session = {
  id: "coord-1",
  studentId: "coord",
  displayName: "Regional Coordinator",
  role: "coordinator",
};
const teacher: Session = { id: "teacher-1", studentId: "teacher", displayName: "Teacher", role: "teacher" };

const REGION_A = "cmregionaaaaaaaaaaaaaaaaa";
const REGION_B = "cmregionbbbbbbbbbbbbbbbbb";
const PASSWORD = "a long enough password";

const INVITERS: readonly Session[] = [admin, programCoordinator, regionalCoordinator, teacher];
const INVITER_IDS = new Set(INVITERS.map((inviter) => inviter.id));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !(value instanceof Date);
}

/** Student rows other than the inviters every case seeds: the accounts a case made or seeded itself. */
function accountRows(): Row[] {
  return fake.state.student.rows.filter((row) => !INVITER_IDS.has(String(row.id)));
}

function setStudent(id: string, patch: Row): void {
  fake.patch("student", id, patch);
}

function seedRow(name: TableName, row: Row): void {
  fake.seed(name, row);
}

function inviteRow(inviteId: string): Row {
  const row = fake.state.staffInvite.rows.find((r) => r.id === inviteId);
  assert.ok(row, `invite ${inviteId} exists`);
  return row;
}

function setInvite(inviteId: string, patch: Row): void {
  fake.patch("staffInvite", inviteId, patch);
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof lib.StaffInviteRefused, `expected StaffInviteRefused, got ${String(error)}`);
    return error.reason;
  }
  assert.fail("expected a refusal");
}

/** Stands in for a working invite email, so non-admins may create invites. */
const delivered = async (): Promise<void> => {};

const TEST_CODE = "246810";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Accept with the right email code. An emailed invite with no code yet gets
 * one first, as if the person pressed "Send my code" (the code itself is
 * covered in `staff-invite-email.test.ts`).
 */
function accept(token: string, email = "pat@example.org") {
  const row = fake.state.staffInvite.rows.find((r) => r.tokenHash === sha256(token));
  if (row?.deliveredByEmail && row.codeHash === null) {
    fake.patch("staffInvite", String(row.id), {
      codeHash: sha256(`${String(row.id)}:${TEST_CODE}`),
      codeExpiresAt: new Date(Date.now() + 10 * 60_000),
    });
  }
  return lib.acceptStaffInvite({ token, email, displayName: "Pat Doe", password: PASSWORD, code: TEST_CODE });
}

beforeEach(() => {
  fake.reset();
  seedRow("region", { id: REGION_A, status: "active" });
  seedRow("region", { id: REGION_B, status: "active" });
  seedRow("regionCoordinator", { regionId: REGION_A, coordinatorId: regionalCoordinator.id });
  // Accepting re-checks the inviter (I4), so every inviter has a live account.
  for (const inviter of INVITERS) {
    seedRow("student", { id: inviter.id, studentId: inviter.studentId, email: null, role: inviter.role, isActive: true });
  }
});

describe("createStaffInvite", () => {
  it("refuses a regional coordinator inviting a teacher to a region they do not coordinate", async () => {
    const reason = await refusal(
      lib.createStaffInvite(regionalCoordinator, { email: "pat@example.org", role: "teacher", regionId: REGION_B }, delivered),
    );
    assert.equal(reason, "region_not_allowed");
    assert.equal(fake.state.staffInvite.rows.length, 0);
  });

  it("refuses an invite into an archived region, for a regional coordinator and an admin alike", async () => {
    fake.patch("region", REGION_A, { status: "archived" });
    for (const inviter of [regionalCoordinator, admin]) {
      const reason = await refusal(
        lib.createStaffInvite(inviter, { email: "pat@example.org", role: "teacher", regionId: REGION_A }, delivered),
      );
      assert.equal(reason, "region_inactive");
    }
    assert.equal(fake.state.staffInvite.rows.length, 0);
  });

  it("still lets an inviter revoke an invite after its region is archived", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    fake.patch("region", REGION_A, { status: "archived" });
    await lib.revokeStaffInvite(admin, invite.inviteId);
    assert.ok(inviteRow(invite.inviteId).revokedAt);
  });

  it("refuses a teacher invite with no region", async () => {
    const reason = await refusal(lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher" }));
    assert.equal(reason, "region_required");
  });

  it("refuses a coordinator invite with no region", async () => {
    const reason = await refusal(lib.createStaffInvite(admin, { email: "pat@example.org", role: "coordinator" }));
    assert.equal(reason, "region_required");
  });

  it("refuses roles the inviter may not invite", async () => {
    assert.equal(
      await refusal(lib.createStaffInvite(regionalCoordinator, { email: "a@b.org", role: "coordinator", regionId: REGION_A }, delivered)),
      "not_allowed",
    );
    assert.equal(
      await refusal(lib.createStaffInvite(programCoordinator, { email: "a@b.org", role: "program_coordinator" }, delivered)),
      "not_allowed",
    );
    assert.equal(
      await refusal(lib.createStaffInvite(teacher, { email: "a@b.org", role: "teacher", regionId: REGION_A }, delivered)),
      "not_allowed",
    );
  });

  it("refuses a region that does not exist, even for an admin", async () => {
    const reason = await refusal(
      lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: "cmnosuchregionaaaaaaaaaaa" }),
    );
    assert.equal(reason, "region_not_allowed");
  });

  it("stores only the SHA-256 of a 32-byte base64url token and expires in 14 days", async () => {
    const startedAt = Date.now();
    const result = await lib.createStaffInvite(regionalCoordinator, {
      email: "  Pat@Example.ORG ",
      role: "teacher",
      regionId: REGION_A,
    }, delivered);
    assert.equal(lib.STAFF_INVITE_TTL_DAYS, 14);
    assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(result.token, "base64url").length, 32);

    const row = inviteRow(result.inviteId);
    assert.equal(row.tokenHash, createHash("sha256").update(result.token).digest("hex"));
    assert.ok(!JSON.stringify(row).includes(result.token), "the plain token is never stored");
    assert.equal(row.email, "pat@example.org");
    assert.equal(row.role, "teacher");
    assert.equal(row.regionId, REGION_A);
    assert.equal(row.invitedById, regionalCoordinator.id);

    const ttlMs = 14 * 24 * 60 * 60 * 1000;
    const expiresAt = result.expiresAt.getTime();
    assert.ok(expiresAt >= startedAt + ttlMs && expiresAt <= Date.now() + ttlMs);
    assert.equal((row.expiresAt as Date).getTime(), expiresAt);
  });

  it("does not store a region on a program-coordinator invite", async () => {
    const result = await lib.createStaffInvite(admin, {
      email: "pc@example.org",
      role: "program_coordinator",
      regionId: REGION_A,
    });
    assert.equal(inviteRow(result.inviteId).regionId, null);
  });
});

describe("acceptStaffInvite", () => {
  async function teacherInviteFromCoordinator() {
    return lib.createStaffInvite(regionalCoordinator, { email: "pat@example.org", role: "teacher", regionId: REGION_A }, delivered);
  }

  async function assertRefusedAndUntouched(token: string, inviteId: string): Promise<void> {
    assert.equal(await refusal(accept(token)), "inviter_no_longer_allowed");
    assert.equal(accountRows().length, 0);
    assert.equal(fake.state.regionInstructor.rows.length, 0);
    assert.equal(inviteRow(inviteId).acceptedAt, null);
  }

  it("refuses an invite whose inviter was deactivated", async () => {
    const invite = await teacherInviteFromCoordinator();
    setStudent(regionalCoordinator.id, { isActive: false });
    await assertRefusedAndUntouched(invite.token, invite.inviteId);
  });

  it("refuses an invite whose inviter account is gone", async () => {
    const invite = await teacherInviteFromCoordinator();
    fake.state.student = { ...fake.state.student, rows: fake.state.student.rows.filter((r) => r.id !== regionalCoordinator.id) };
    await assertRefusedAndUntouched(invite.token, invite.inviteId);
  });

  it("refuses an invite whose inviter may no longer invite that role", async () => {
    const invite = await lib.createStaffInvite(programCoordinator, {
      email: "pat@example.org",
      role: "coordinator",
      regionId: REGION_B,
    }, delivered);
    setStudent(programCoordinator.id, { role: "coordinator" });
    assert.equal(await refusal(accept(invite.token)), "inviter_no_longer_allowed");
    assert.equal(accountRows().length, 0);
    assert.equal(inviteRow(invite.inviteId).acceptedAt, null);
  });

  it("refuses a coordinator-sent invite once the coordinator left the invite's region", async () => {
    const invite = await teacherInviteFromCoordinator();
    fake.state.regionCoordinator = { ...fake.state.regionCoordinator, rows: [] };
    await assertRefusedAndUntouched(invite.token, invite.inviteId);
  });

  it("still accepts while the coordinator coordinates the region", async () => {
    const invite = await teacherInviteFromCoordinator();
    await accept(invite.token);
    assert.equal(accountRows().length, 1);
  });

  it("creates one teacher account with a normalized email and a RegionInstructor row", async () => {
    const invite = await lib.createStaffInvite(regionalCoordinator, {
      email: "pat@example.org",
      role: "teacher",
      regionId: REGION_A,
    }, delivered);
    const { staffId } = await accept(invite.token);

    assert.equal(accountRows().length, 1);
    const account = accountRows()[0];
    assert.equal(account.id, staffId);
    assert.equal(account.role, "teacher");
    assert.equal(account.email, "pat@example.org");
    assert.equal(account.displayName, "Pat Doe");
    assert.equal(account.studentId, "pat");
    assert.match(String(account.passwordHash), /^scrypt\$/);
    assert.ok(!String(account.passwordHash).includes(PASSWORD));

    assert.deepEqual(
      fake.state.regionInstructor.rows.map(({ regionId, instructorId, assignedById }) => ({ regionId, instructorId, assignedById })),
      [{ regionId: REGION_A, instructorId: staffId, assignedById: regionalCoordinator.id }],
    );
    assert.equal(fake.state.regionCoordinator.rows.length, 1, "only the seeded coordinator row");

    const row = inviteRow(invite.inviteId);
    assert.ok(row.acceptedAt instanceof Date);
    assert.equal(row.acceptedById, staffId);
    assert.equal(fake.transactions, 1);
  });

  it("creates a RegionCoordinator row for a coordinator invite", async () => {
    const invite = await lib.createStaffInvite(programCoordinator, {
      email: "rc@example.org",
      role: "coordinator",
      regionId: REGION_B,
    }, delivered);
    const { staffId } = await accept(invite.token, "rc@example.org");

    const account = accountRows().find((r) => r.id === staffId);
    assert.equal(account?.role, "coordinator");
    assert.ok(fake.state.regionCoordinator.rows.some((r) => r.regionId === REGION_B && r.coordinatorId === staffId));
    assert.equal(fake.state.regionInstructor.rows.length, 0);
  });

  it("creates no region row for a program-coordinator invite", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pc@example.org", role: "program_coordinator" });
    const { staffId } = await accept(invite.token, "pc@example.org");

    assert.equal(accountRows().find((r) => r.id === staffId)?.role, "program_coordinator");
    assert.equal(fake.state.regionInstructor.rows.length, 0);
    assert.equal(fake.state.regionCoordinator.rows.length, 1, "only the seeded coordinator row");
  });

  it("ignores email casing", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    const { staffId } = await accept(invite.token, "Pat@Example.org");
    assert.equal(accountRows().find((r) => r.id === staffId)?.email, "pat@example.org");
  });

  it("refuses a second accept as used", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    await accept(invite.token);
    assert.equal(await refusal(accept(invite.token)), "used");
    assert.equal(accountRows().length, 1);
  });

  it("refuses an invite after expiresAt as expired", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    setInvite(invite.inviteId, { expiresAt: new Date(Date.now() - 1000) });
    assert.equal(await refusal(accept(invite.token)), "expired");
    assert.equal(accountRows().length, 0);
  });

  it("refuses a revoked invite as revoked", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    await lib.revokeStaffInvite(admin, invite.inviteId);
    assert.equal(await refusal(accept(invite.token)), "revoked");
    assert.equal(accountRows().length, 0);
  });

  it("refuses an unknown token as invalid", async () => {
    assert.equal(await refusal(accept("not-a-real-token")), "invalid");
  });

  it("makes one account from two concurrent accepts of one token", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    const results = await Promise.allSettled([accept(invite.token), accept(invite.token)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof lib.StaffInviteRefused);
    assert.equal(rejected[0].reason.reason, "used");
    assert.equal(accountRows().length, 1);
    assert.equal(fake.state.regionInstructor.rows.length, 1);
  });

  it("refuses a typed email that does not match the invite, and leaves the invite usable", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    assert.equal(await refusal(accept(invite.token, "someone@example.org")), "email_mismatch");
    assert.equal(inviteRow(invite.inviteId).acceptedAt, null);
    assert.equal(accountRows().length, 0);

    await accept(invite.token);
    assert.equal(accountRows().length, 1);
  });

  it("refuses an invite whose email already has an account as account_exists, and leaves the invite unaccepted", async () => {
    seedRow("student", { id: "existing-1", studentId: "pat.existing", email: "pat@example.org", role: "student" });
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });

    assert.equal(await refusal(accept(invite.token)), "account_exists");
    assert.equal(inviteRow(invite.inviteId).acceptedAt, null);
    assert.equal(accountRows().length, 1);
    assert.equal(fake.state.regionInstructor.rows.length, 0);
  });

  it("answers account_exists, not a database error, when another accept for the email commits first", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    // A second invite to the same email is accepted between this accept's
    // email check and its insert, so the insert hits the unique email index.
    fake.beforeCreate((table) => {
      if (table === "student") {
        fake.beforeCreate(() => undefined);
        seedRow("student", { id: "racer-1", studentId: "pat.racer", email: "pat@example.org", role: "teacher" });
      }
    });

    assert.equal(await refusal(accept(invite.token)), "account_exists");
    assert.equal(inviteRow(invite.inviteId).acceptedAt, null);
    assert.equal(fake.state.regionInstructor.rows.length, 0);
  });

  it("finds an existing account whose stored email differs only in casing", async () => {
    seedRow("student", { id: "existing-1", studentId: "pat.existing", email: "Pat@Example.ORG", role: "teacher" });
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });

    assert.equal(await refusal(accept(invite.token)), "account_exists");
    assert.equal(inviteRow(invite.inviteId).acceptedAt, null);
    assert.equal(accountRows().length, 1);
  });

  it("refuses an invite whose region was deleted as invalid, never a database error", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    fake.remove("region", REGION_A);

    assert.equal(await refusal(accept(invite.token)), "invalid");
    assert.equal(inviteRow(invite.inviteId).acceptedAt, null);
    assert.equal(accountRows().length, 0);
    assert.equal(fake.state.regionInstructor.rows.length, 0);
  });

  it("maps a region deleted mid-accept (a foreign-key failure) to invalid", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "coordinator", regionId: REGION_B });
    // The region exists when the accept starts and is gone when its row is written.
    fake.beforeCreate((table) => {
      if (table === "regionCoordinator") fake.remove("region", REGION_B);
    });

    assert.equal(await refusal(accept(invite.token)), "invalid");
    assert.equal(inviteRow(invite.inviteId).acceptedAt, null);
    assert.equal(accountRows().length, 0);
  });

  it("gives the login name a suffix when the email local part is taken", async () => {
    seedRow("student", { id: "existing-1", studentId: "pat", email: "pat@other.org", role: "student" });
    seedRow("student", { id: "existing-2", studentId: "pat-2", email: null, role: "student" });
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    const { staffId } = await accept(invite.token);
    assert.equal(accountRows().find((r) => r.id === staffId)?.studentId, "pat-3");
  });

  it("enforces the staff registration password rules and creates nothing on a short one", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    await assert.rejects(
      lib.acceptStaffInvite({ token: invite.token, email: "pat@example.org", displayName: "Pat", password: "short" }),
    );
    await assert.rejects(
      lib.acceptStaffInvite({ token: invite.token, email: "pat@example.org", displayName: "Pat", password: "x".repeat(MAX_PASSWORD_LENGTH + 1) }),
    );
    assert.equal(accountRows().length, 0);
    assert.equal(inviteRow(invite.inviteId).acceptedAt, null);
  });
});

describe("revokeStaffInvite", () => {
  it("marks the invite revoked", async () => {
    const invite = await lib.createStaffInvite(regionalCoordinator, {
      email: "pat@example.org",
      role: "teacher",
      regionId: REGION_A,
    }, delivered);
    await lib.revokeStaffInvite(regionalCoordinator, invite.inviteId);
    assert.ok(inviteRow(invite.inviteId).revokedAt instanceof Date);
  });

  it("refuses a regional coordinator revoking an invite outside their regions", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_B });
    assert.equal(await refusal(lib.revokeStaffInvite(regionalCoordinator, invite.inviteId)), "region_not_allowed");
    assert.equal(inviteRow(invite.inviteId).revokedAt, null);
  });

  it("refuses someone who could not have sent the invite", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pc@example.org", role: "program_coordinator" });
    assert.equal(await refusal(lib.revokeStaffInvite(programCoordinator, invite.inviteId)), "not_allowed");
    assert.equal(await refusal(lib.revokeStaffInvite(teacher, invite.inviteId)), "not_allowed");
  });

  it("refuses an accepted invite as used, a revoked one as revoked, an unknown one as invalid", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    await accept(invite.token);
    assert.equal(await refusal(lib.revokeStaffInvite(admin, invite.inviteId)), "used");

    const second = await lib.createStaffInvite(admin, { email: "kim@example.org", role: "teacher", regionId: REGION_A });
    await lib.revokeStaffInvite(admin, second.inviteId);
    assert.equal(await refusal(lib.revokeStaffInvite(admin, second.inviteId)), "revoked");

    assert.equal(await refusal(lib.revokeStaffInvite(admin, "no-such-invite")), "invalid");
  });
});

describe("audit", () => {
  it("records create, accept and revoke with ids and role only", async () => {
    const accepted = await lib.createStaffInvite(regionalCoordinator, {
      email: "pat@example.org",
      role: "teacher",
      regionId: REGION_A,
    }, delivered);
    const { staffId } = await accept(accepted.token);
    const revoked = await lib.createStaffInvite(admin, { email: "kim@example.org", role: "program_coordinator" });
    await lib.revokeStaffInvite(admin, revoked.inviteId);

    const rows = fake.state.auditLog.rows;
    assert.deepEqual(
      rows.map((r) => [r.action, r.actorId, r.targetId]),
      [
        ["staff_invite.create", regionalCoordinator.id, accepted.inviteId],
        ["staff_invite.accept", staffId, accepted.inviteId],
        ["staff_invite.create", admin.id, revoked.inviteId],
        ["staff_invite.revoke", admin.id, revoked.inviteId],
      ],
    );
    for (const row of rows) {
      const metadata: unknown = JSON.parse(String(row.metadata));
      assert.ok(isPlainObject(metadata));
      assert.ok(!("email" in metadata), `${String(row.action)} metadata has no email key`);
      const serialized = JSON.stringify(row);
      assert.ok(!serialized.includes("example.org"), `${String(row.action)} row carries no email`);
      assert.ok(!serialized.includes("Pat Doe"), `${String(row.action)} row carries no name`);
      assert.ok(!serialized.includes(accepted.token), `${String(row.action)} row carries no token`);
    }
    const firstMetadata: unknown = JSON.parse(String(rows[0].metadata));
    assert.deepEqual(firstMetadata, { role: "teacher", regionId: REGION_A, deliveredByEmail: true });
  });
});
