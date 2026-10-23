import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import jwt from "jsonwebtoken";

// Logout used to delete only the browser's cookie. A copy of the session token
// taken before logout kept full authority until its 7-day expiry. Logout now
// records the presented token as revoked, getSession refuses it, and every
// other session on the same account keeps working.

const TEST_JWT_SECRET = "logout-revocation-test-secret-0123456789abcdef";

interface StudentRow {
  id: string;
  studentId: string;
  displayName: string;
  role: string;
  sessionVersion: number;
  isActive: boolean;
  demoAccount: "student" | "instructor" | null;
}

interface RevocationCreateArgs {
  data: { tokenHash: string; expiresAt: Date };
}

interface RevocationFindArgs {
  where: { tokenHash: string };
}

const students = new Map<string, StudentRow>();
const revocations = new Map<string, Date>();
let failRevocationWrite = false;
let failRevocationRead = false;

function prismaError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

const mockStudentFindUnique = mock.fn(async (args: { where: { id: string } }) =>
  students.get(args.where.id) ?? null,
);
const mockRevocationCreate = mock.fn(async (args: RevocationCreateArgs) => {
  if (failRevocationWrite) throw prismaError("store unavailable", "P1001");
  if (revocations.has(args.data.tokenHash)) throw prismaError("duplicate", "P2002");
  revocations.set(args.data.tokenHash, args.data.expiresAt);
  return args.data;
});
const mockRevocationFindUnique = mock.fn(async (args: RevocationFindArgs) => {
  if (failRevocationRead) throw prismaError("store unavailable", "P1001");
  return revocations.has(args.where.tokenHash) ? { tokenHash: args.where.tokenHash } : null;
});
const mockLoggerError = mock.fn<(message: string, context?: Record<string, unknown>) => void>();

let sessionCookieValue: string | undefined;
const deletedCookies: string[] = [];

mock.module("next/headers", {
  exports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "vq-session" && sessionCookieValue !== undefined
          ? { name, value: sessionCookieValue }
          : undefined,
      set: () => undefined,
      delete: (name: string) => {
        deletedCookies.push(name);
        if (name === "vq-session") sessionCookieValue = undefined;
      },
    }),
  },
});

mock.module("./db", {
  exports: {
    prisma: {},
    prismaAdmin: {
      student: { findUnique: mockStudentFindUnique },
      sageConfirmationUse: { create: mockRevocationCreate, findUnique: mockRevocationFindUnique },
    },
  },
});

mock.module("./logger", {
  exports: {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: mockLoggerError,
    },
  },
});

let getSession: typeof import("./auth").getSession;
let clearSession: typeof import("./auth").clearSession;
let signToken: typeof import("./auth").signToken;

// Each test uses its own account so the 10 second session cache never hands
// one test another test's result.
let nextId = 0;
function freshStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  nextId += 1;
  const id = `logout-revocation-${nextId}`;
  const row: StudentRow = {
    id,
    studentId: `login-${id}`,
    displayName: "Some Person",
    role: "teacher",
    sessionVersion: 1,
    isActive: true,
    demoAccount: null,
    ...overrides,
  };
  students.set(id, row);
  return row;
}

async function sessionFor(token: string) {
  sessionCookieValue = token;
  return getSession();
}

before(async () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  ({ getSession, clearSession, signToken } = await import("./auth"));
});

beforeEach(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  sessionCookieValue = undefined;
  deletedCookies.length = 0;
  failRevocationWrite = false;
  failRevocationRead = false;
  mockLoggerError.mock.resetCalls();
});

describe("logout revokes the presented session token", () => {
  it("refuses a token replayed after logout while the account's other sessions keep working", async () => {
    const row = freshStudent();
    const loggedOutToken = signToken(row.id, row.role, row.sessionVersion);
    const otherDeviceToken = signToken(row.id, row.role, row.sessionVersion);

    assert.ok(await sessionFor(loggedOutToken), "the token works before logout");
    assert.ok(await sessionFor(otherDeviceToken), "the other session works before logout");

    sessionCookieValue = loggedOutToken;
    await clearSession();
    assert.ok(deletedCookies.includes("vq-session"), "logout still deletes the cookie");

    assert.equal(await sessionFor(loggedOutToken), null, "a replayed copy of the logged-out token is refused");
    const other = await sessionFor(otherDeviceToken);
    assert.equal(other?.id, row.id, "the other session on the account is untouched");
  });

  it("gives two tokens minted at once for the shared demo instructor their own identity", async () => {
    process.env.COHORT_DEMO_MODE = "true";
    try {
      const row = freshStudent({ demoAccount: "instructor" });
      const first = signToken(row.id, row.role, row.sessionVersion, { demo: "instructor" });
      const second = signToken(row.id, row.role, row.sessionVersion, { demo: "instructor" });
      assert.notEqual(first, second, "same-second tokens for one account must differ");

      sessionCookieValue = first;
      await clearSession();

      assert.equal(await sessionFor(first), null);
      assert.equal((await sessionFor(second))?.id, row.id, "one visitor's logout leaves the others signed in");
    } finally {
      delete process.env.COHORT_DEMO_MODE;
    }
  });

  it("still accepts and can revoke a token issued before tokens carried a jti", async () => {
    const row = freshStudent();
    const legacy = jwt.sign({ sub: row.id, role: row.role, sv: row.sessionVersion }, TEST_JWT_SECRET, {
      expiresIn: "7d",
      algorithm: "HS256",
    });

    assert.equal((await sessionFor(legacy))?.id, row.id);
    await clearSession();
    assert.equal(await sessionFor(legacy), null);
  });

  it("fails closed when the revocation store cannot be read", async () => {
    const row = freshStudent();
    failRevocationRead = true;

    await assert.rejects(sessionFor(signToken(row.id, row.role, row.sessionVersion)));
  });

  it("still signs the browser out, and logs, when the revocation cannot be recorded", async () => {
    const row = freshStudent();
    const token = signToken(row.id, row.role, row.sessionVersion);
    failRevocationWrite = true;
    sessionCookieValue = token;

    await assert.doesNotReject(clearSession());

    assert.equal(sessionCookieValue, undefined, "the cookie is gone");
    assert.ok(deletedCookies.includes("vq-session"));
    assert.equal(mockLoggerError.mock.callCount(), 1, "the failed revocation is logged");
    const [, context] = mockLoggerError.mock.calls[0].arguments;
    assert.deepEqual(context, { error: { name: "Error", code: "P1001" } });
    const logged = JSON.stringify(mockLoggerError.mock.calls[0].arguments);
    assert.equal(logged.includes(row.id), false, "no account id in the log line");
    assert.equal(logged.includes(token), false, "no token in the log line");
  });
});
