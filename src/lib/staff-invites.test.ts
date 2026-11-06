import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";

// Staff invites against an in-memory stand-in for Postgres. Only `@/lib/db`
// is mocked: org-roles, region and the module under test all run for real
// (MEMORY.md Known Issues: a mocked predicate hides the bug it should catch).
//
// Every fake call yields to the event loop first, so two accepts started
// together interleave the way two requests would. `updateMany` checks and
// writes in one synchronous step, like a row lock. A writing transaction that
// throws is rolled back through an undo log.

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

interface Table {
  rows: Row[];
  unique: string[];
}

interface FakeState {
  staffInvite: Table;
  student: Table;
  regionCoordinator: Table;
  regionInstructor: Table;
  region: Table;
  auditLog: Table;
}

type TableName = keyof FakeState;

function emptyState(): FakeState {
  return {
    staffInvite: { rows: [], unique: ["id", "tokenHash"] },
    student: { rows: [], unique: ["id", "studentId", "email"] },
    regionCoordinator: { rows: [], unique: [] },
    regionInstructor: { rows: [], unique: [] },
    region: { rows: [], unique: ["id"] },
    auditLog: { rows: [], unique: [] },
  };
}

let state: FakeState = emptyState();
let idCounter = 0;

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !(value instanceof Date);
}

function matchesField(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
  if (isPlainObject(expected)) {
    if ("gt" in expected) {
      const bound = expected.gt;
      return actual instanceof Date && bound instanceof Date && actual.getTime() > bound.getTime();
    }
    if ("startsWith" in expected) {
      return typeof actual === "string" && actual.startsWith(String(expected.startsWith));
    }
    throw new Error(`fake db: unsupported filter ${JSON.stringify(expected)}`);
  }
  return actual === expected;
}

function flattenWhere(where: Where): Where {
  const flat: Where = {};
  for (const [key, value] of Object.entries(where)) {
    if (key.includes("_") && isPlainObject(value)) Object.assign(flat, value);
    else flat[key] = value;
  }
  return flat;
}

function matches(row: Row, where: Where): boolean {
  return Object.entries(flattenWhere(where)).every(([key, value]) => matchesField(row[key], value));
}

function assertUnique(table: Table, candidate: Row, selfIndex: number): void {
  for (const key of table.unique) {
    const value = candidate[key];
    if (value === null || value === undefined) continue;
    const clash = table.rows.some((row, index) => index !== selfIndex && row[key] === value);
    if (clash) throw Object.assign(new Error(`Unique constraint failed on ${key}`), { code: "P2002" });
  }
}

function makeDelegate(name: TableName, undo: Array<() => void> | null) {
  const table = () => state[name];
  const record = (restore: () => void) => undo?.push(restore);

  return {
    async create(args: { data: Row }) {
      await tick();
      idCounter += 1;
      // Postgres returns null for a nullable column nobody set.
      const nullDefaults = name === "staffInvite" ? { acceptedAt: null, acceptedById: null, revokedAt: null } : {};
      const row: Row = { id: `${name}-${idCounter}`, createdAt: new Date(), ...nullDefaults, ...args.data };
      assertUnique(table(), row, -1);
      state[name] = { ...table(), rows: [...table().rows, row] };
      record(() => {
        state[name] = { ...table(), rows: table().rows.filter((r) => r !== row) };
      });
      return row;
    },
    async findUnique(args: { where: Where }) {
      await tick();
      return table().rows.find((row) => matches(row, args.where)) ?? null;
    },
    async findFirst(args: { where: Where }) {
      await tick();
      return table().rows.find((row) => matches(row, args.where)) ?? null;
    },
    async findMany(args: { where?: Where }) {
      await tick();
      return table().rows.filter((row) => matches(row, args.where ?? {}));
    },
    async count(args: { where?: Where }) {
      await tick();
      return table().rows.filter((row) => matches(row, args.where ?? {})).length;
    },
    async updateMany(args: { where: Where; data: Row }) {
      await tick();
      const before = table().rows;
      const after = before.map((row) => (matches(row, args.where) ? { ...row, ...args.data } : row));
      const count = before.filter((row) => matches(row, args.where)).length;
      state[name] = { ...table(), rows: after };
      record(() => {
        state[name] = { ...table(), rows: before };
      });
      return { count };
    },
    async update(args: { where: Where; data: Row }) {
      await tick();
      const before = table().rows;
      const index = before.findIndex((row) => matches(row, args.where));
      if (index < 0) throw Object.assign(new Error("Record not found"), { code: "P2025" });
      const updated = { ...before[index], ...args.data };
      assertUnique(table(), updated, index);
      state[name] = { ...table(), rows: before.map((row, i) => (i === index ? updated : row)) };
      record(() => {
        state[name] = { ...table(), rows: before };
      });
      return updated;
    },
  };
}

const TABLES: TableName[] = [
  "staffInvite",
  "student",
  "regionCoordinator",
  "regionInstructor",
  "region",
  "auditLog",
];

function makeClient(undo: Array<() => void> | null) {
  return Object.fromEntries(TABLES.map((name) => [name, makeDelegate(name, undo)]));
}

const transactionCalls = { count: 0 };

const fakeClient = {
  ...makeClient(null),
  async $transaction<T>(fn: (tx: ReturnType<typeof makeClient>) => Promise<T>): Promise<T> {
    transactionCalls.count += 1;
    const undo: Array<() => void> = [];
    try {
      return await fn(makeClient(undo));
    } catch (error) {
      for (const restore of [...undo].reverse()) restore();
      throw error;
    }
  },
};

mock.module("@/lib/db", {
  exports: { prisma: fakeClient, prismaAdmin: fakeClient },
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

function seedRow(name: TableName, row: Row): void {
  state[name] = { ...state[name], rows: [...state[name].rows, row] };
}

function inviteRow(inviteId: string): Row {
  const row = state.staffInvite.rows.find((r) => r.id === inviteId);
  assert.ok(row, `invite ${inviteId} exists`);
  return row;
}

function setInvite(inviteId: string, patch: Row): void {
  state.staffInvite = {
    ...state.staffInvite,
    rows: state.staffInvite.rows.map((r) => (r.id === inviteId ? { ...r, ...patch } : r)),
  };
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

function accept(token: string, email = "pat@example.org") {
  return lib.acceptStaffInvite({ token, email, displayName: "Pat Doe", password: PASSWORD });
}

beforeEach(() => {
  state = emptyState();
  transactionCalls.count = 0;
  seedRow("region", { id: REGION_A, status: "active" });
  seedRow("region", { id: REGION_B, status: "active" });
  seedRow("regionCoordinator", { regionId: REGION_A, coordinatorId: regionalCoordinator.id });
});

describe("createStaffInvite", () => {
  it("refuses a regional coordinator inviting a teacher to a region they do not coordinate", async () => {
    const reason = await refusal(
      lib.createStaffInvite(regionalCoordinator, { email: "pat@example.org", role: "teacher", regionId: REGION_B }),
    );
    assert.equal(reason, "region_not_allowed");
    assert.equal(state.staffInvite.rows.length, 0);
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
      await refusal(lib.createStaffInvite(regionalCoordinator, { email: "a@b.org", role: "coordinator", regionId: REGION_A })),
      "not_allowed",
    );
    assert.equal(
      await refusal(lib.createStaffInvite(programCoordinator, { email: "a@b.org", role: "program_coordinator" })),
      "not_allowed",
    );
    assert.equal(
      await refusal(lib.createStaffInvite(teacher, { email: "a@b.org", role: "teacher", regionId: REGION_A })),
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
    });
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
  it("creates one teacher account with a normalized email and a RegionInstructor row", async () => {
    const invite = await lib.createStaffInvite(regionalCoordinator, {
      email: "pat@example.org",
      role: "teacher",
      regionId: REGION_A,
    });
    const { staffId } = await accept(invite.token);

    assert.equal(state.student.rows.length, 1);
    const account = state.student.rows[0];
    assert.equal(account.id, staffId);
    assert.equal(account.role, "teacher");
    assert.equal(account.email, "pat@example.org");
    assert.equal(account.displayName, "Pat Doe");
    assert.equal(account.studentId, "pat");
    assert.match(String(account.passwordHash), /^scrypt\$/);
    assert.ok(!String(account.passwordHash).includes(PASSWORD));

    assert.deepEqual(
      state.regionInstructor.rows.map(({ regionId, instructorId, assignedById }) => ({ regionId, instructorId, assignedById })),
      [{ regionId: REGION_A, instructorId: staffId, assignedById: regionalCoordinator.id }],
    );
    assert.equal(state.regionCoordinator.rows.length, 1, "only the seeded coordinator row");

    const row = inviteRow(invite.inviteId);
    assert.ok(row.acceptedAt instanceof Date);
    assert.equal(row.acceptedById, staffId);
    assert.equal(transactionCalls.count, 1);
  });

  it("creates a RegionCoordinator row for a coordinator invite", async () => {
    const invite = await lib.createStaffInvite(programCoordinator, {
      email: "rc@example.org",
      role: "coordinator",
      regionId: REGION_B,
    });
    const { staffId } = await accept(invite.token, "rc@example.org");

    const account = state.student.rows.find((r) => r.id === staffId);
    assert.equal(account?.role, "coordinator");
    assert.ok(state.regionCoordinator.rows.some((r) => r.regionId === REGION_B && r.coordinatorId === staffId));
    assert.equal(state.regionInstructor.rows.length, 0);
  });

  it("creates no region row for a program-coordinator invite", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pc@example.org", role: "program_coordinator" });
    const { staffId } = await accept(invite.token, "pc@example.org");

    assert.equal(state.student.rows.find((r) => r.id === staffId)?.role, "program_coordinator");
    assert.equal(state.regionInstructor.rows.length, 0);
    assert.equal(state.regionCoordinator.rows.length, 1, "only the seeded coordinator row");
  });

  it("ignores email casing", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    const { staffId } = await accept(invite.token, "Pat@Example.org");
    assert.equal(state.student.rows.find((r) => r.id === staffId)?.email, "pat@example.org");
  });

  it("refuses a second accept as used", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    await accept(invite.token);
    assert.equal(await refusal(accept(invite.token)), "used");
    assert.equal(state.student.rows.length, 1);
  });

  it("refuses an invite after expiresAt as expired", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    setInvite(invite.inviteId, { expiresAt: new Date(Date.now() - 1000) });
    assert.equal(await refusal(accept(invite.token)), "expired");
    assert.equal(state.student.rows.length, 0);
  });

  it("refuses a revoked invite as revoked", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    await lib.revokeStaffInvite(admin, invite.inviteId);
    assert.equal(await refusal(accept(invite.token)), "revoked");
    assert.equal(state.student.rows.length, 0);
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
    assert.equal(state.student.rows.length, 1);
    assert.equal(state.regionInstructor.rows.length, 1);
  });

  it("refuses a typed email that does not match the invite, and leaves the invite usable", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    assert.equal(await refusal(accept(invite.token, "someone@example.org")), "email_mismatch");
    assert.equal(inviteRow(invite.inviteId).acceptedAt, null);
    assert.equal(state.student.rows.length, 0);

    await accept(invite.token);
    assert.equal(state.student.rows.length, 1);
  });

  it("refuses an invite whose email already has an account, and leaves the invite unaccepted", async () => {
    seedRow("student", { id: "existing-1", studentId: "pat.existing", email: "pat@example.org", role: "student" });
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });

    assert.equal(await refusal(accept(invite.token)), "email_mismatch");
    assert.equal(inviteRow(invite.inviteId).acceptedAt, null);
    assert.equal(state.student.rows.length, 1);
    assert.equal(state.regionInstructor.rows.length, 0);
  });

  it("gives the login name a suffix when the email local part is taken", async () => {
    seedRow("student", { id: "existing-1", studentId: "pat", email: "pat@other.org", role: "student" });
    seedRow("student", { id: "existing-2", studentId: "pat-2", email: null, role: "student" });
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    const { staffId } = await accept(invite.token);
    assert.equal(state.student.rows.find((r) => r.id === staffId)?.studentId, "pat-3");
  });

  it("enforces the staff registration password rules and creates nothing on a short one", async () => {
    const invite = await lib.createStaffInvite(admin, { email: "pat@example.org", role: "teacher", regionId: REGION_A });
    await assert.rejects(
      lib.acceptStaffInvite({ token: invite.token, email: "pat@example.org", displayName: "Pat", password: "short" }),
    );
    await assert.rejects(
      lib.acceptStaffInvite({ token: invite.token, email: "pat@example.org", displayName: "Pat", password: "x".repeat(129) }),
    );
    assert.equal(state.student.rows.length, 0);
    assert.equal(inviteRow(invite.inviteId).acceptedAt, null);
  });
});

describe("revokeStaffInvite", () => {
  it("marks the invite revoked", async () => {
    const invite = await lib.createStaffInvite(regionalCoordinator, {
      email: "pat@example.org",
      role: "teacher",
      regionId: REGION_A,
    });
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
    });
    const { staffId } = await accept(accepted.token);
    const revoked = await lib.createStaffInvite(admin, { email: "kim@example.org", role: "program_coordinator" });
    await lib.revokeStaffInvite(admin, revoked.inviteId);

    const rows = state.auditLog.rows;
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
    assert.deepEqual(firstMetadata, { role: "teacher", regionId: REGION_A });
  });
});
