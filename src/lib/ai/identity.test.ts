import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * `loadIdentityInput` — the one loader that tells a TokenVault which values
 * belong to the person this request is about (AC1 of the Wave 2 wiring
 * ticket).
 *
 * Two properties are load-bearing and are what these cases pin:
 *
 *  1. It never widens what the caller's own RLS context can see. Everything
 *     goes through the app client; nothing reaches for `prismaAdmin`.
 *  2. It NEVER throws. It runs inside `resolveAiProvider`, on the chat hot
 *     path, so a blocked or failing lookup must degrade to an absent field —
 *     an identity we could not load is a vault entry we do not have, not a
 *     500 on a student's chat turn.
 */

interface StudentRow {
  displayName: string;
  email: string | null;
  studentId: string;
  role: string;
}

const findUnique = mock.fn<(args: unknown) => Promise<StudentRow | null>>();
const findFirst = mock.fn<(args: unknown) => Promise<{ destination: string | null } | null>>();
const findMany = mock.fn<(args: unknown) => Promise<{ displayName: string }[]>>();

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: { findUnique, findMany },
      notificationPreference: { findFirst },
    },
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    buildManagedStudentWhere: (session: { id: string; role: string }) => ({
      role: "student",
      __actor: session.id,
      __role: session.role,
    }),
  },
});

let loadIdentityInput: typeof import("./identity").loadIdentityInput;
let listManagedRosterNames: typeof import("./identity").listManagedRosterNames;
let MANAGED_ROSTER_CAP: typeof import("./identity").MANAGED_ROSTER_CAP;
let clearIdentityCache: typeof import("./identity").clearIdentityCache;

before(async () => {
  ({ loadIdentityInput, listManagedRosterNames, MANAGED_ROSTER_CAP, clearIdentityCache } =
    await import("./identity"));
});

beforeEach(() => {
  findUnique.mock.resetCalls();
  findFirst.mock.resetCalls();
  findMany.mock.resetCalls();
  findUnique.mock.mockImplementation(async () => ({
    displayName: "Jordan Lee",
    email: "jordan.lee@example.org",
    studentId: "jlee2026",
    role: "student",
  }));
  findFirst.mock.mockImplementation(async () => ({ destination: "+13045550134" }));
  findMany.mock.mockImplementation(async () => [
    { displayName: "Sam Okafor" },
    { displayName: "Arturo Diaz" },
  ]);
  clearIdentityCache();
});

describe("loadIdentityInput — student session", () => {
  it("returns the student's own display name, email, login id and SMS destination", async () => {
    const identity = await loadIdentityInput({ studentId: "stu1", sessionRole: "student" });
    assert.deepEqual(identity, {
      studentName: "Jordan Lee",
      studentEmail: "jordan.lee@example.org",
      studentLoginId: "jlee2026",
      studentPhone: "+13045550134",
    });
  });

  it("selects only the columns it vaults", async () => {
    await loadIdentityInput({ studentId: "stu1", sessionRole: "student" });
    const args = findUnique.mock.calls[0].arguments[0] as { select: Record<string, boolean> };
    assert.deepEqual(Object.keys(args.select).sort(), ["displayName", "email", "role", "studentId"]);
    const prefArgs = findFirst.mock.calls[0].arguments[0] as { select: Record<string, boolean> };
    assert.deepEqual(Object.keys(prefArgs.select), ["destination"]);
  });

  it("loads no roster for a student session — a student may not see other students", async () => {
    const identity = await loadIdentityInput({ studentId: "stu1", sessionRole: "student" });
    assert.equal(identity.rosterNames, undefined);
    assert.equal(findMany.mock.callCount(), 0);
  });

  it("issues exactly one query per table", async () => {
    await loadIdentityInput({ studentId: "stu1", sessionRole: "student" });
    assert.equal(findUnique.mock.callCount(), 1);
    assert.equal(findFirst.mock.callCount(), 1);
  });

  it("infers the role from the row when the caller passes none", async () => {
    findUnique.mock.mockImplementation(async () => ({
      displayName: "Ms. Lee",
      email: null,
      studentId: "mlee",
      role: "teacher",
    }));
    const identity = await loadIdentityInput({ studentId: "teach1" });
    assert.deepEqual(identity.staffNames, ["Ms. Lee"]);
    assert.equal(identity.studentName, undefined);
  });
});

describe("loadIdentityInput — staff session", () => {
  it("vaults the staff member's own name and the managed roster", async () => {
    const identity = await loadIdentityInput({
      studentId: "teach1",
      sessionRole: "teacher",
      sessionDisplayName: "Ms. Lee",
    });
    assert.deepEqual(identity, {
      staffNames: ["Ms. Lee"],
      rosterNames: ["Sam Okafor", "Arturo Diaz"],
    });
    // The session already carries the display name; no row read for it.
    assert.equal(findUnique.mock.callCount(), 0);
  });

  it("caps the roster at the same 500 staff-student-context uses", async () => {
    await loadIdentityInput({ studentId: "teach1", sessionRole: "teacher", sessionDisplayName: "Ms. Lee" });
    const args = findMany.mock.calls[0].arguments[0] as { take: number; select: Record<string, boolean> };
    assert.equal(args.take, MANAGED_ROSTER_CAP);
    assert.equal(MANAGED_ROSTER_CAP, 500);
    assert.deepEqual(Object.keys(args.select), ["displayName"]);
  });

  it("reads no SMS destination for a staff session", async () => {
    await loadIdentityInput({ studentId: "teach1", sessionRole: "admin", sessionDisplayName: "Admin" });
    assert.equal(findFirst.mock.callCount(), 0);
  });

  it("treats a coordinator as staff (their roster comes back empty by the fail-closed clause)", async () => {
    findMany.mock.mockImplementation(async () => []);
    const identity = await loadIdentityInput({
      studentId: "coord1",
      sessionRole: "coordinator",
      sessionDisplayName: "Coord One",
    });
    assert.deepEqual(identity, { staffNames: ["Coord One"] });
  });
});

describe("loadIdentityInput — a blocked lookup degrades, never throws", () => {
  it("returns an empty identity when the student row read is refused", async () => {
    findUnique.mock.mockImplementation(async () => {
      throw new Error("new row violates row-level security policy");
    });
    const identity = await loadIdentityInput({ studentId: "stu1", sessionRole: "student" });
    assert.deepEqual(identity, { studentPhone: "+13045550134" });
  });

  it("keeps the name when only the notification-preference read is refused", async () => {
    findFirst.mock.mockImplementation(async () => {
      throw new Error("permission denied for table NotificationPreference");
    });
    const identity = await loadIdentityInput({ studentId: "stu1", sessionRole: "student" });
    assert.equal(identity.studentName, "Jordan Lee");
    assert.equal(identity.studentPhone, undefined);
  });

  it("keeps the staff name when the roster read is refused", async () => {
    findMany.mock.mockImplementation(async () => {
      throw new Error("permission denied");
    });
    const identity = await loadIdentityInput({
      studentId: "teach1",
      sessionRole: "teacher",
      sessionDisplayName: "Ms. Lee",
    });
    assert.deepEqual(identity, { staffNames: ["Ms. Lee"] });
  });

  it("drops blank and missing values rather than vaulting an empty string", async () => {
    findUnique.mock.mockImplementation(async () => ({
      displayName: "Jordan Lee",
      email: null,
      studentId: "   ",
      role: "student",
    }));
    findFirst.mock.mockImplementation(async () => ({ destination: null }));
    const identity = await loadIdentityInput({ studentId: "stu1", sessionRole: "student" });
    assert.deepEqual(identity, { studentName: "Jordan Lee" });
  });
});

describe("loadIdentityInput — caching", () => {
  it("serves a second resolve for the same (student, role) from cache", async () => {
    await loadIdentityInput({ studentId: "stu1", sessionRole: "student" });
    await loadIdentityInput({ studentId: "stu1", sessionRole: "student" });
    assert.equal(findUnique.mock.callCount(), 1, "the chat route and post-response both resolve");
  });

  it("does not let one role's identity serve another", async () => {
    await loadIdentityInput({ studentId: "stu1", sessionRole: "student" });
    await loadIdentityInput({ studentId: "stu1", sessionRole: "teacher", sessionDisplayName: "Ms. Lee" });
    assert.equal(findMany.mock.callCount(), 1);
  });
});

describe("listManagedRosterNames", () => {
  it("scopes through buildManagedStudentWhere with the caller's own session", async () => {
    const names = await listManagedRosterNames({
      id: "teach1",
      studentId: "mlee",
      displayName: "Ms. Lee",
      role: "teacher",
    });
    assert.deepEqual(names, ["Sam Okafor", "Arturo Diaz"]);
    const args = findMany.mock.calls[0].arguments[0] as { where: Record<string, unknown> };
    assert.equal(args.where.__actor, "teach1");
    assert.equal(args.where.__role, "teacher");
  });
});
