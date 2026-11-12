import assert from "node:assert/strict";
import crypto from "node:crypto";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Sign-in primes the session cache (readiness F1)
//
// Sign-in has just read the account row and checked it. The first page after
// signing in used to read the same row again. Now sign-in keeps it, so that
// page's session check reads no account.
//
// The real auth module, the real cache and the real password hash run here.
// Only the database, the limiter and the audit log are stand-ins. The last
// test is the one that matters most: a row that changed while the password
// was being checked must not be kept, or sign-in would bring a deactivated
// account's session back for the whole cache window.
// ---------------------------------------------------------------------------

process.env.JWT_SECRET = "test-value-for-the-login-session-prime-suite";

const PASSWORD = "a classroom password";

interface AccountRow {
  id: string;
  studentId: string;
  email: string | null;
  displayName: string;
  role: string;
  passwordHash: string | null;
  authProvider: string;
  isActive: boolean;
  mfaEnabled: boolean;
  sessionVersion: number;
  mustChangePassword: boolean;
  demoAccount: string | null;
}

type AccountWhere = { id?: string; studentId?: string; email?: string };

const accounts = new Map<string, AccountRow>();
/** Runs once, after sign-in has read the account and before it checks the password. */
let whilePasswordIsChecked: (() => void) | null = null;

/** Account reads by id: the session check's lookup, never sign-in's own. */
const accountReadsById = mock.fn(async (id: string) => {
  const row = accounts.get(id);
  return row ? { ...row } : null;
});

async function findAccount(args: { where: AccountWhere }): Promise<AccountRow | null> {
  const { id, studentId, email } = args.where;
  if (id !== undefined) return accountReadsById(id);
  const match = [...accounts.values()].find((row) => (studentId ? row.studentId === studentId : row.email === email));
  return match ? { ...match } : null;
}

/** The one conditional write sign-in makes: the legacy-hash upgrade. */
async function upgradeHash(args: {
  where: { id: string; passwordHash: string | null };
  data: { passwordHash: string };
}): Promise<{ count: number }> {
  const row = accounts.get(args.where.id);
  if (!row || row.passwordHash !== args.where.passwordHash) return { count: 0 };
  accounts.set(row.id, { ...row, passwordHash: args.data.passwordHash });
  return { count: 1 };
}

const fakeDb = {
  student: { findUnique: findAccount, updateMany: upgradeHash },
  sageConfirmationUse: { findUnique: async () => null },
};

let sessionCookieValue: string | undefined;

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "vq-session" && sessionCookieValue !== undefined ? { name, value: sessionCookieValue } : undefined,
      set: (name: string, value: string) => {
        if (name === "vq-session") sessionCookieValue = value;
      },
    }),
  },
});

mock.module("@/lib/db", { namedExports: { prismaAdmin: fakeDb, prisma: fakeDb } });

mock.module("@/lib/rate-limit", {
  namedExports: {
    // The per-account count runs between the account read and the password
    // check, which makes it the place to land a concurrent write.
    rateLimit: async (key: string) => {
      if (key.startsWith("login:user:") && whilePasswordIsChecked) {
        const land = whilePasswordIsChecked;
        whilePasswordIsChecked = null;
        land();
      }
      return { success: true, remaining: 4, resetTime: Date.now() + 60_000, degraded: false };
    },
    refundRateLimit: async () => undefined,
  },
});

mock.module("@/lib/audit", { namedExports: { logAuditEvent: async () => undefined } });

let loginRoute: Awaited<typeof import("../route")>;
let auth: typeof import("@/lib/auth");
let cached: typeof import("@/lib/cache").cached;
let passwordHash: string;

let nextId = 0;
function freshAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  nextId += 1;
  const id = `session-prime-${nextId}`;
  const row: AccountRow = {
    id,
    studentId: `learner${nextId}`,
    email: null,
    displayName: "Some Person",
    role: "student",
    passwordHash,
    authProvider: "password",
    isActive: true,
    mfaEnabled: false,
    sessionVersion: 1,
    mustChangePassword: false,
    demoAccount: null,
    ...overrides,
  };
  accounts.set(id, row);
  return row;
}

async function signIn(row: AccountRow, password: string = PASSWORD): Promise<number> {
  const res = await loginRoute.POST(
    mockRequest("/api/auth/login", { method: "POST", body: { studentId: row.studentId, password } }) as never,
  );
  return res.status;
}

/** What the session cache holds for this account, or a marker when it holds nothing. */
function cachedRowFor(row: AccountRow): Promise<unknown> {
  return cached(`session:${row.id}:${row.sessionVersion}`, 1, async () => "nothing cached");
}

before(async () => {
  auth = await import("@/lib/auth");
  ({ cached } = await import("@/lib/cache"));
  loginRoute = await import("../route");
  ({ hash: passwordHash } = await auth.hashPassword(PASSWORD));
});

beforeEach(() => {
  sessionCookieValue = undefined;
  whilePasswordIsChecked = null;
  accountReadsById.mock.resetCalls();
});

describe("POST /api/auth/login: the session cache", () => {
  it("lets the first request after sign-in check its session without reading the account", async () => {
    const row = freshAccount();

    assert.equal(await signIn(row), 200);
    assert.ok(sessionCookieValue, "sign-in set the session cookie");
    const session = await auth.getSession();

    assert.deepEqual(session, {
      id: row.id,
      studentId: row.studentId,
      displayName: "Some Person",
      role: "student",
    });
    assert.equal(accountReadsById.mock.callCount(), 0);
  });

  it("primes a held session as held", async () => {
    const row = freshAccount({ mustChangePassword: true });

    assert.equal(await signIn(row), 200);
    const session = await auth.getSession();

    assert.equal(session?.mustChangePassword, true);
    assert.equal(accountReadsById.mock.callCount(), 0);
  });

  it("keeps nothing for a sign-in that failed", async () => {
    const row = freshAccount();

    assert.equal(await signIn(row, "not the password"), 401);

    assert.equal(sessionCookieValue, undefined);
    assert.equal(await cachedRowFor(row), "nothing cached");
  });

  it("keeps nothing before the second factor is given", async () => {
    const row = freshAccount({ role: "teacher", mfaEnabled: true });

    assert.equal(await signIn(row), 200);

    assert.equal(sessionCookieValue, undefined, "no session yet: the MFA challenge comes first");
    assert.equal(await cachedRowFor(row), "nothing cached");
  });

  it("upgrades a legacy hash without changing anything the session reads", async () => {
    // Sign-in rewrites the stored hash and does not tell the session cache.
    // That is right only because the session reads whether a hash exists,
    // never the hash: the row read after the upgrade gives the same session.
    const salt = crypto.randomBytes(16).toString("hex");
    const legacyHash = `${salt}:${crypto.pbkdf2Sync(PASSWORD, salt, 100000, 64, "sha512").toString("hex")}`;
    const row = freshAccount({ passwordHash: legacyHash, mustChangePassword: true });

    assert.equal(await signIn(row), 200);
    assert.match(accounts.get(row.id)?.passwordHash ?? "", /^scrypt\$/, "the hash was upgraded");
    const fromPrimedRow = await auth.getSession();
    auth.invalidateSessionCache(row.id);
    const fromUpgradedRow = await auth.getSession();

    assert.equal(fromPrimedRow?.mustChangePassword, true);
    assert.deepEqual(fromUpgradedRow, fromPrimedRow);
    assert.equal(accountReadsById.mock.callCount(), 1, "only the second check read the account");
  });

  it("does not bring back an account that was deactivated while its password was being checked", async () => {
    const row = freshAccount();
    whilePasswordIsChecked = () => {
      // Staff deactivate the account: the write commits, then tells the cache.
      accounts.set(row.id, { ...row, isActive: false, sessionVersion: 2 });
      auth.invalidateSessionCache(row.id);
    };

    // Sign-in had already read the active row, so it still answers 200 and
    // sets a cookie for version 1. That cookie must be dead on arrival.
    assert.equal(await signIn(row), 200);
    assert.equal(whilePasswordIsChecked, null, "the deactivation landed during sign-in");

    assert.equal(await auth.getSession(), null);
    assert.equal(accountReadsById.mock.callCount(), 1, "the session check read the account itself");
  });
});
