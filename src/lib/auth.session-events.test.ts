import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { createFakeDatabase, type AccountRow } from "./auth.session-events.fake-db";

// getSession() keeps an account row for 60 seconds, so every event that ends
// or changes a session has to drop that row itself. This file takes each
// event in turn and drives the REAL route or helper that performs it:
//
//   sign-out, a staff password reset, the student's own password change, an
//   emailed reset link, a reset by recovery questions, deactivation and
//   reactivation, offboarding, and a role change.
//
// For each one the session is used first, so its row is cached. While the
// write is still on its way to the database, the same browser sends another
// request. Then, with no waiting, the old token is tried again and must be
// refused. That middle request is what proves the order: code that dropped the
// cached row before its write committed would let that request put the old
// row straight back, and the last step would then find the session alive.
//
// The real auth module, cache, revocation store and password hash run here.
// The database is the in-memory stand-in beside this file.

process.env.JWT_SECRET = "test-value-for-the-session-events-suite";
// Hashes reset-link tokens (src/lib/password-reset.ts). Any value will do here.
process.env.API_KEY_ENCRYPTION_KEY = "test-value-for-reset-link-hashing";

const CURRENT_PASSWORD = "the password in use";
const NEW_PASSWORD = "a brand new password";
const RECOVERY_ANSWERS = { birth_city: "Charleston", elementary_school: "Piedmont", favorite_teacher: "Ms Avery" };

const db = createFakeDatabase();
const jar: { value: string | undefined } = { value: undefined };

mock.module("next/headers", {
  exports: {
    cookies: async () => ({
      get: (name: string) => (name === "vq-session" && jar.value !== undefined ? { name, value: jar.value } : undefined),
      set: (name: string, value: string) => {
        if (name === "vq-session") jar.value = value;
      },
      delete: (name: string) => {
        if (name === "vq-session") jar.value = undefined;
      },
    }),
  },
});

mock.module("./db", { exports: { prisma: db.client, prismaAdmin: db.client } });

mock.module("./audit", {
  exports: { logAuditEvent: async () => undefined, tryLogAuditEvent: async () => ({ audited: true }) },
});

mock.module("./logger", {
  exports: {
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
  },
});

mock.module("./rate-limit", {
  exports: {
    rateLimit: async () => ({ success: true, remaining: 4, resetTime: Date.now() + 60_000, degraded: false }),
    refundRateLimit: async () => undefined,
  },
});

mock.module("./student-archive", {
  exports: { generateStudentArchive: async () => ({ storageKey: "archives/test/archive.zip", fileCount: 1 }) },
});

mock.module("./connect/connections", {
  exports: { withdrawConnectionsForConsentRevocation: async () => ({ withdrawn: 0 }) },
});

let auth: typeof import("./auth");
let changeOwnPassword: typeof import("./password-change").changeOwnPassword;
let promoteTeacherToAdmin: typeof import("./promote-staff-account").promoteTeacherToAdmin;
let hashPasswordResetToken: typeof import("./password-reset").hashPasswordResetToken;
let signOut: typeof import("@/app/api/auth/session/route").DELETE;
let staffReset: typeof import("@/app/api/teacher/students/[id]/reset-password/route").POST;
let setStatus: typeof import("@/app/api/teacher/students/[id]/status/route").PATCH;
let offboard: typeof import("@/app/api/admin/students/[id]/offboard/route").POST;
let resetByLink: typeof import("@/app/api/auth/reset-password/route").POST;
let resetByQuestions: typeof import("@/app/api/auth/reset-password/questions/route").POST;

let currentPasswordHash: string;
let recoveryAnswerHashes: AccountRow["securityQuestionAnswers"];

// Ids shaped like the database's, which the offboarding route insists on.
let nextId = 0;
function freshAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  nextId += 1;
  return db.addAccount({
    id: `csessionevents${String(nextId).padStart(6, "0")}`,
    studentId: `learner${nextId}`,
    email: null,
    displayName: "Some Person",
    role: "student",
    sessionVersion: 1,
    isActive: true,
    demoAccount: null,
    mustChangePassword: false,
    passwordHash: currentPasswordHash,
    mfaEnabled: false,
    offboardedAt: null,
    securityQuestionAnswers: recoveryAnswerHashes,
    ...overrides,
  });
}

function tokenFor(row: AccountRow, options: { mustChangePassword?: boolean } = {}): string {
  return auth.signToken(row.id, row.role, row.sessionVersion, options);
}

async function sessionFor(token: string) {
  jar.value = token;
  return auth.getSession();
}

/**
 * Arms a second request from the same browser to land while the next account
 * write is still on its way to the database. Answers whether it has landed.
 */
function requestLandsMidWrite(token: string): () => boolean {
  let landed = false;
  db.beforeNextCommit(async () => {
    const actorCookie = jar.value;
    jar.value = token;
    await auth.getSession();
    jar.value = actorCookie;
    landed = true;
  });
  return () => landed;
}

/** Runs a staff action with that staff member's own session cookie. */
async function asStaff(actor: AccountRow, action: () => Promise<Response>): Promise<Response> {
  jar.value = tokenFor(actor);
  return action();
}

function jsonRequest(path: string, method: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const routeParams = (id: string) => ({ params: Promise.resolve({ id }) });

before(async () => {
  auth = await import("./auth");
  ({ changeOwnPassword } = await import("./password-change"));
  ({ promoteTeacherToAdmin } = await import("./promote-staff-account"));
  ({ hashPasswordResetToken } = await import("./password-reset"));
  ({ DELETE: signOut } = await import("@/app/api/auth/session/route"));
  ({ POST: staffReset } = await import("@/app/api/teacher/students/[id]/reset-password/route"));
  ({ PATCH: setStatus } = await import("@/app/api/teacher/students/[id]/status/route"));
  ({ POST: offboard } = await import("@/app/api/admin/students/[id]/offboard/route"));
  ({ POST: resetByLink } = await import("@/app/api/auth/reset-password/route"));
  ({ POST: resetByQuestions } = await import("@/app/api/auth/reset-password/questions/route"));

  const { hashSecurityAnswers } = await import("./security-question-auth");
  ({ hash: currentPasswordHash } = await auth.hashPassword(CURRENT_PASSWORD));
  recoveryAnswerHashes = await hashSecurityAnswers(RECOVERY_ANSWERS);
});

beforeEach(() => {
  jar.value = undefined;
});

describe("sign-out", () => {
  it("refuses the signed-out token on the very next request", async () => {
    const student = freshAccount();
    const token = tokenFor(student);
    assert.ok(await sessionFor(token), "the session works, and both its lookups are now cached");

    jar.value = token;
    assert.equal((await signOut()).status, 200);

    assert.equal(await sessionFor(token), null);
  });
});

describe("a password reset or change ends every session the account had", () => {
  it("a staff reset: the old session ends and the next one is held to the change screen", async () => {
    const teacher = freshAccount({ role: "teacher" });
    const student = freshAccount();
    const oldToken = tokenFor(student);
    assert.ok(await sessionFor(oldToken));
    const landed = requestLandsMidWrite(oldToken);

    const response = await asStaff(teacher, () =>
      staffReset(jsonRequest("/reset", "POST", { newPassword: NEW_PASSWORD }), routeParams(student.id)),
    );

    assert.equal(response.status, 200);
    assert.equal(landed(), true, "a request landed while the write was on its way");
    assert.equal(await sessionFor(oldToken), null);
    const after = db.account(student.id);
    assert.equal(after.mustChangePassword, true);
    const held = await sessionFor(tokenFor(after, { mustChangePassword: true }));
    assert.equal(held?.mustChangePassword, true);
  });

  it("the student's own change: this device's old token and every other device's end", async () => {
    const student = freshAccount({ mustChangePassword: true });
    const heldToken = tokenFor(student, { mustChangePassword: true });
    const otherDevice = tokenFor(student, { mustChangePassword: true });
    assert.ok(await sessionFor(heldToken));
    assert.ok(await sessionFor(otherDevice));
    const landed = requestLandsMidWrite(heldToken);

    const result = await changeOwnPassword({
      accountId: student.id,
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    assert.equal(result.kind, "changed");
    assert.equal(landed(), true);
    assert.equal(await sessionFor(heldToken), null);
    assert.equal(await sessionFor(otherDevice), null);
    const session = await sessionFor(tokenFor(db.account(student.id)));
    assert.ok(session, "a session for the new version works at once");
    assert.equal("mustChangePassword" in session, false, "and is no longer held");
  });

  it("an emailed reset link: the old session ends and the one the route issues works", async () => {
    const student = freshAccount();
    const oldToken = tokenFor(student);
    assert.ok(await sessionFor(oldToken));
    db.addResetLink({
      id: `link-${student.id}`,
      tokenHash: hashPasswordResetToken("the-emailed-token"),
      studentId: student.id,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const landed = requestLandsMidWrite(oldToken);
    jar.value = undefined;

    const response = await resetByLink(
      jsonRequest("/api/auth/reset-password", "POST", { token: "the-emailed-token", password: NEW_PASSWORD }),
    );

    assert.equal(response.status, 200);
    assert.equal(landed(), true);
    const issued = jar.value;
    assert.ok(issued, "the route signed the student in");
    assert.equal(await sessionFor(oldToken), null);
    assert.equal((await sessionFor(issued))?.id, student.id);
  });

  it("a reset by recovery questions: the old session ends and the one the route issues works", async () => {
    const student = freshAccount();
    const oldToken = tokenFor(student);
    assert.ok(await sessionFor(oldToken));
    const landed = requestLandsMidWrite(oldToken);
    jar.value = undefined;

    const response = await resetByQuestions(
      jsonRequest("/api/auth/reset-password/questions", "POST", {
        login: student.studentId,
        password: NEW_PASSWORD,
        securityQuestions: RECOVERY_ANSWERS,
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(landed(), true);
    const issued = jar.value;
    assert.ok(issued, "the route signed the student in");
    assert.equal(await sessionFor(oldToken), null);
    assert.equal((await sessionFor(issued))?.id, student.id);
  });

  it("wrong recovery answers reset nothing and end nothing", async () => {
    const student = freshAccount();
    const token = tokenFor(student);
    assert.ok(await sessionFor(token));
    jar.value = undefined;

    const response = await resetByQuestions(
      jsonRequest("/api/auth/reset-password/questions", "POST", {
        login: student.studentId,
        password: NEW_PASSWORD,
        securityQuestions: { ...RECOVERY_ANSWERS, favorite_teacher: "Somebody Else" },
      }),
    );

    assert.equal(response.status, 400);
    assert.equal(jar.value, undefined, "no session was issued");
    assert.equal(db.account(student.id).passwordHash, currentPasswordHash);
    assert.equal((await sessionFor(token))?.id, student.id);
  });
});

describe("closing an account ends its sessions", () => {
  it("deactivation ends the session, and reactivation is seen at once too", async () => {
    const teacher = freshAccount({ role: "teacher" });
    const student = freshAccount();
    const oldToken = tokenFor(student);
    assert.ok(await sessionFor(oldToken));
    const landed = requestLandsMidWrite(oldToken);

    const closed = await asStaff(teacher, () =>
      setStatus(jsonRequest("/status", "PATCH", { isActive: false }), routeParams(student.id)),
    );

    assert.equal(closed.status, 200);
    assert.equal(landed(), true);
    assert.equal(await sessionFor(oldToken), null);
    // A token for the new version finds the account closed, and that row is cached.
    const tokenForNewVersion = tokenFor(db.account(student.id));
    assert.equal(await sessionFor(tokenForNewVersion), null);

    const reopened = await asStaff(teacher, () =>
      setStatus(jsonRequest("/status", "PATCH", { isActive: true }), routeParams(student.id)),
    );

    assert.equal(reopened.status, 200);
    assert.equal((await sessionFor(tokenForNewVersion))?.id, student.id, "reactivated: seen with no waiting");
    assert.equal(await sessionFor(oldToken), null, "the token from before the deactivation stays dead");
  });

  it("offboarding ends the session, the first time and when it is repeated", async () => {
    const admin = freshAccount({ role: "admin" });
    const student = freshAccount();
    const oldToken = tokenFor(student);
    assert.ok(await sessionFor(oldToken));
    const landed = requestLandsMidWrite(oldToken);

    const first = await asStaff(admin, () => offboard(jsonRequest("/offboard", "POST", {}), routeParams(student.id)));

    assert.equal(first.status, 200);
    assert.equal(landed(), true);
    assert.equal(await sessionFor(oldToken), null);
    assert.equal(db.account(student.id).isActive, false);

    // Suppose the account were switched back on by hand, and someone held a
    // token for its current version. Offboarding again must end that too.
    db.addAccount({ ...db.account(student.id), isActive: true });
    auth.invalidateSessionCache(student.id);
    const laterToken = tokenFor(db.account(student.id));
    assert.ok(await sessionFor(laterToken));
    const landedAgain = requestLandsMidWrite(laterToken);

    const second = await asStaff(admin, () => offboard(jsonRequest("/offboard", "POST", {}), routeParams(student.id)));

    assert.equal(second.status, 200);
    assert.equal(landedAgain(), true);
    assert.equal(await sessionFor(laterToken), null);
  });
});

describe("the demo reset", () => {
  // resetDemoRoster runs only from scripts/reset-demo-roster.ts, a separate
  // process, so no invalidation can reach this one. Its runbook turns demo
  // mode off on every server first, and getSession() reads that switch after
  // the cache, so the switch is what ends demo sessions at once.
  it("ends demo sessions at once once demo mode is off, though the reset itself is unseen", async () => {
    process.env.COHORT_DEMO_MODE = "true";
    try {
      const visitor = freshAccount({ demoAccount: "student", passwordHash: null });
      const token = auth.signToken(visitor.id, visitor.role, visitor.sessionVersion, { demo: "student" });
      assert.equal((await sessionFor(token))?.demoAccount, "student", "the row is now cached");

      // What the offline reset writes, done the way that script does it: with
      // no call into this process.
      db.addAccount({ ...db.account(visitor.id), isActive: false, sessionVersion: visitor.sessionVersion + 1 });
      assert.ok(await sessionFor(token), "this process cannot see a write it did not make until the window ends");

      delete process.env.COHORT_DEMO_MODE;
      assert.equal(await sessionFor(token), null);
    } finally {
      delete process.env.COHORT_DEMO_MODE;
    }
  });
});

describe("a role change", () => {
  it("ends the old role's session, and a new session carries the new role", async () => {
    const teacher = freshAccount({ role: "teacher" });
    const teacherToken = tokenFor(teacher);
    assert.equal((await sessionFor(teacherToken))?.role, "teacher");
    const landed = requestLandsMidWrite(teacherToken);

    const promoted = await promoteTeacherToAdmin({ accountId: teacher.id, ip: "203.0.113.7" });

    assert.equal(promoted.role, "admin");
    assert.equal(landed(), true);
    assert.equal(await sessionFor(teacherToken), null);
    assert.equal((await sessionFor(tokenFor(db.account(teacher.id))))?.role, "admin");
  });
});
