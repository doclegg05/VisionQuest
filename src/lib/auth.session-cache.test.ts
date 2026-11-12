import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// getSession() runs on every signed-in request. It checks that the token was
// not revoked and reads the account row, both at once, and keeps the row for
// 60 seconds. A cache on a session check is only safe if nothing can keep a
// session alive past the moment it should end, so most of this file is about
// that: every kind of change to the account, and sign-out, must be seen by
// the very next request, with no waiting.
//
// The real cache (src/lib/cache.ts) and the real revocation store
// (src/lib/session-revocation.ts) run here. Only the database is a stand-in.

const TEST_JWT_SECRET = "test-value-for-the-session-cache-suite";
const PASSWORD_HASH = "scrypt$test-salt$test-hash";

interface StudentRow {
  id: string;
  studentId: string;
  displayName: string;
  role: string;
  sessionVersion: number;
  isActive: boolean;
  demoAccount: "student" | "instructor" | null;
  mustChangePassword: boolean;
  passwordHash: string | null;
}

const students = new Map<string, StudentRow>();
const revocations = new Set<string>();
/** When set, every lookup waits on it before it answers. */
let held: Promise<void> | null = null;
let failAccountRead = false;
let failRevocationRead = false;

// Each lookup takes its answer when it is issued, as a database read sees the
// rows as they were when it ran, and only then waits.
const accountLookup = mock.fn(async (args: { where: { id: string } }) => {
  const row = students.get(args.where.id);
  const answer = row ? { ...row } : null;
  if (held) await held;
  if (failAccountRead) throw new Error("account store unavailable");
  return answer;
});
const revocationLookup = mock.fn(async (args: { where: { tokenHash: string } }) => {
  const answer = revocations.has(args.where.tokenHash) ? { tokenHash: args.where.tokenHash } : null;
  if (held) await held;
  if (failRevocationRead) throw new Error("revocation store unavailable");
  return answer;
});
const revocationCreate = mock.fn(async (args: { data: { tokenHash: string } }) => {
  revocations.add(args.data.tokenHash);
  return args.data;
});

let sessionCookieValue: string | undefined;

mock.module("next/headers", {
  exports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "vq-session" && sessionCookieValue !== undefined ? { name, value: sessionCookieValue } : undefined,
      set: () => undefined,
      delete: (name: string) => {
        if (name === "vq-session") sessionCookieValue = undefined;
      },
    }),
  },
});

mock.module("./db", {
  exports: {
    prisma: {},
    prismaAdmin: {
      student: { findUnique: accountLookup },
      sageConfirmationUse: { findUnique: revocationLookup, create: revocationCreate },
    },
  },
});

mock.module("./logger", {
  exports: {
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
  },
});

type AuthModule = typeof import("./auth");
let auth: AuthModule;
let cached: typeof import("./cache").cached;

// Every test uses its own account, so one test's cached row is never another's.
let nextId = 0;
function freshStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  nextId += 1;
  const id = `session-cache-${nextId}`;
  const row: StudentRow = {
    id,
    studentId: `login-${id}`,
    displayName: "Some Person",
    role: "student",
    sessionVersion: 1,
    isActive: true,
    demoAccount: null,
    mustChangePassword: false,
    passwordHash: PASSWORD_HASH,
    ...overrides,
  };
  students.set(id, row);
  return row;
}

/** Writes the row as another request's database write would, without telling the cache. */
function writeRow(id: string, changes: Partial<StudentRow>): StudentRow {
  const current = students.get(id);
  assert.ok(current, "the test changed a row it never made");
  const next = { ...current, ...changes };
  students.set(id, next);
  return next;
}

function tokenFor(row: StudentRow, options: { mustChangePassword?: boolean; demo?: "student" | "instructor" } = {}) {
  return auth.signToken(row.id, row.role, row.sessionVersion, options);
}

async function sessionFor(token: string) {
  sessionCookieValue = token;
  return auth.getSession();
}

function resetLookupCounts(): void {
  accountLookup.mock.resetCalls();
  revocationLookup.mock.resetCalls();
}

/** Makes every lookup wait until the returned function is called. */
function holdLookups(): () => void {
  let release: () => void = () => undefined;
  held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    held = null;
    release();
  };
}

/** One full turn of the event loop: everything already due has run. */
function turn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

before(async () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  auth = await import("./auth");
  ({ cached } = await import("./cache"));
});

beforeEach(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  delete process.env.COHORT_DEMO_MODE;
  sessionCookieValue = undefined;
  held = null;
  failAccountRead = false;
  failRevocationRead = false;
  resetLookupCounts();
});

describe("the session cache window", () => {
  it("keeps the account row for 60 seconds", () => {
    assert.equal(auth.SESSION_CACHE_TTL_S, 60);
  });

  it("issues no lookup for a second call inside the window", async () => {
    const row = freshStudent();
    const token = tokenFor(row);
    assert.equal((await sessionFor(token))?.id, row.id);
    assert.equal(accountLookup.mock.callCount(), 1);
    assert.equal(revocationLookup.mock.callCount(), 1);
    resetLookupCounts();

    const again = await sessionFor(token);

    assert.equal(again?.id, row.id);
    assert.equal(accountLookup.mock.callCount(), 0);
    assert.equal(revocationLookup.mock.callCount(), 0);
  });

  it("issues both lookups of a cold call before either has answered", async () => {
    const row = freshStudent();
    const release = holdLookups();

    const pending = sessionFor(tokenFor(row));
    await turn();

    // Neither lookup can have answered: both are still held.
    assert.equal(revocationLookup.mock.callCount(), 1, "the revocation check was issued");
    assert.equal(accountLookup.mock.callCount(), 1, "the account read did not wait for it");

    release();
    assert.equal((await pending)?.id, row.id);
  });

  it("reads the row again once 60 seconds have passed, and not before", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const row = freshStudent();
    const token = tokenFor(row);
    await sessionFor(token);
    resetLookupCounts();

    t.mock.timers.tick(59_000);
    assert.equal((await sessionFor(token))?.id, row.id);
    assert.equal(accountLookup.mock.callCount(), 0, "59 seconds on, the row is still the cached one");

    t.mock.timers.tick(2_000);
    assert.equal((await sessionFor(token))?.id, row.id);
    assert.equal(accountLookup.mock.callCount(), 1, "61 seconds on, the row is read again");
  });

  it("stores the row under session:<id>:<version>, without the password hash", async () => {
    const row = freshStudent({ mustChangePassword: true });
    await sessionFor(tokenFor(row, { mustChangePassword: true }));

    const stored = await cached(`session:${row.id}:${row.sessionVersion}`, 1, async () => "nothing was stored");

    assert.deepEqual(stored, {
      id: row.id,
      studentId: row.studentId,
      displayName: row.displayName,
      role: "student",
      sessionVersion: 1,
      isActive: true,
      demoAccount: null,
      mustChangePassword: true,
    });
    assert.equal(JSON.stringify(stored).includes(PASSWORD_HASH), false);
  });

  it("gives no session when the account read fails, and does not keep the failure", async () => {
    const row = freshStudent();
    const token = tokenFor(row);
    failAccountRead = true;
    await assert.rejects(sessionFor(token), /account store unavailable/);

    failAccountRead = false;
    assert.equal((await sessionFor(token))?.id, row.id, "the next request reads again");
  });

  it("gives no session, and leaves no stray rejection, when both lookups fail", async () => {
    const row = freshStudent();
    const stray: unknown[] = [];
    const onStray = (reason: unknown) => stray.push(reason);
    process.on("unhandledRejection", onStray);
    try {
      failAccountRead = true;
      failRevocationRead = true;

      await assert.rejects(sessionFor(tokenFor(row)));
      await turn();
      await turn();

      assert.deepEqual(stray, []);
    } finally {
      process.off("unhandledRejection", onStray);
    }
  });
});

describe("sign-in primes the cache", () => {
  it("lets the first request after sign-in skip the account read", async () => {
    const prime = auth.sessionCachePrimer();
    const row = freshStudent();
    prime(row);

    const session = await sessionFor(tokenFor(row));

    assert.deepEqual(session, {
      id: row.id,
      studentId: row.studentId,
      displayName: row.displayName,
      role: "student",
    });
    assert.equal(accountLookup.mock.callCount(), 0);
  });

  it("primes a held session as held, so the token's claim and the cached row agree", async () => {
    const prime = auth.sessionCachePrimer();
    const row = freshStudent({ mustChangePassword: true });
    prime(row);

    const session = await sessionFor(tokenFor(row, { mustChangePassword: true }));

    assert.equal(session?.mustChangePassword, true);
    assert.equal(accountLookup.mock.callCount(), 0);
  });

  it("stores no password hash", async () => {
    const prime = auth.sessionCachePrimer();
    const row = freshStudent();
    prime(row);

    const stored = await cached(`session:${row.id}:${row.sessionVersion}`, 1, async () => "nothing was stored");

    assert.equal(typeof stored, "object");
    assert.equal(JSON.stringify(stored).includes(PASSWORD_HASH), false);
  });

  it("does not prime with a row that was changed after sign-in read it", async () => {
    // Sign-in takes the primer, then reads the row.
    const prime = auth.sessionCachePrimer();
    const rowAsSignInReadIt = { ...freshStudent() };
    // Before sign-in finishes, staff deactivate the account.
    writeRow(rowAsSignInReadIt.id, { isActive: false, sessionVersion: 2 });
    auth.invalidateSessionCache(rowAsSignInReadIt.id);

    prime(rowAsSignInReadIt);

    assert.equal(await sessionFor(tokenFor(rowAsSignInReadIt)), null, "the stale row must not come back");
    assert.equal(accountLookup.mock.callCount(), 1, "the request read the account instead");
  });
});

describe("a change to the account is seen by the very next request", () => {
  it("ends every old session when the session version is bumped (a password reset or change)", async () => {
    const row = freshStudent();
    const oldToken = tokenFor(row);
    assert.ok(await sessionFor(oldToken), "the session works, and its row is now cached");

    const changed = writeRow(row.id, { sessionVersion: 2 });
    auth.invalidateSessionCache(row.id);

    assert.equal(await sessionFor(oldToken), null);
    assert.equal((await sessionFor(tokenFor(changed)))?.id, row.id, "a token for the new version works");
  });

  it("ends the session when the account is deactivated, and returns it when reactivated", async () => {
    const row = freshStudent();
    const token = tokenFor(row);
    assert.ok(await sessionFor(token));

    writeRow(row.id, { isActive: false });
    auth.invalidateSessionCache(row.id);
    assert.equal(await sessionFor(token), null, "deactivated");

    writeRow(row.id, { isActive: true });
    auth.invalidateSessionCache(row.id);
    assert.equal((await sessionFor(token))?.id, row.id, "reactivated");
  });

  it("ends the session when the account row is deleted", async () => {
    const row = freshStudent();
    const token = tokenFor(row);
    assert.ok(await sessionFor(token));

    students.delete(row.id);
    auth.invalidateSessionCache(row.id);

    assert.equal(await sessionFor(token), null);
  });

  it("ends the old role's session when the role changes, and the new session carries the new role", async () => {
    const row = freshStudent({ role: "teacher" });
    const oldToken = tokenFor(row);
    assert.equal((await sessionFor(oldToken))?.role, "teacher");

    const promoted = writeRow(row.id, { role: "admin", sessionVersion: 2 });
    auth.invalidateSessionCache(row.id);

    assert.equal(await sessionFor(oldToken), null);
    assert.equal((await sessionFor(tokenFor(promoted)))?.role, "admin");
  });

  it("ends an ordinary session once staff set a password the student must change", async () => {
    const row = freshStudent();
    const oldToken = tokenFor(row);
    assert.ok(await sessionFor(oldToken));

    const reset = writeRow(row.id, { mustChangePassword: true, sessionVersion: 2 });
    auth.invalidateSessionCache(row.id);

    assert.equal(await sessionFor(oldToken), null);
    const heldSession = await sessionFor(tokenFor(reset, { mustChangePassword: true }));
    assert.equal(heldSession?.mustChangePassword, true, "the new session is held to the change screen");
  });

  it("ends a held session once the student has chosen a password", async () => {
    const row = freshStudent({ mustChangePassword: true });
    const heldToken = tokenFor(row, { mustChangePassword: true });
    assert.equal((await sessionFor(heldToken))?.mustChangePassword, true);

    const changed = writeRow(row.id, { mustChangePassword: false, sessionVersion: 2 });
    auth.invalidateSessionCache(row.id);

    assert.equal(await sessionFor(heldToken), null);
    const session = await sessionFor(tokenFor(changed));
    assert.ok(session);
    assert.equal("mustChangePassword" in session, false, "the new session is no longer held");
  });

  it("does not keep a row whose read began before the change", async () => {
    const row = freshStudent();
    const token = tokenFor(row);
    const release = holdLookups();
    // A request reads the account while it is still active...
    const requestInFlight = sessionFor(token);
    await turn();
    // ...staff deactivate it, and the write tells the cache...
    writeRow(row.id, { isActive: false, sessionVersion: 2 });
    auth.invalidateSessionCache(row.id);
    // ...and only then does the first read answer, with the old row.
    release();
    await requestInFlight;

    assert.equal(await sessionFor(token), null, "the old row was not stored");
  });

  it("honors a write this process never saw only once the window has passed", async (t) => {
    // A script or a SQL console cannot tell this process's cache. This is the
    // one way a changed row is still honored, and 60 seconds is its limit.
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const row = freshStudent();
    const token = tokenFor(row);
    assert.ok(await sessionFor(token));

    writeRow(row.id, { isActive: false });

    t.mock.timers.tick(59_000);
    assert.ok(await sessionFor(token), "inside the window the cached row still answers");
    t.mock.timers.tick(2_000);
    assert.equal(await sessionFor(token), null, "past the window the change is seen");
  });
});

describe("sign-out", () => {
  it("refuses the signed-out token on the very next request, from a warm cache", async () => {
    const row = freshStudent();
    const signedOut = tokenFor(row);
    const otherDevice = tokenFor(row);
    assert.ok(await sessionFor(signedOut));
    assert.ok(await sessionFor(otherDevice));

    sessionCookieValue = signedOut;
    await auth.clearSession();
    resetLookupCounts();

    assert.equal(await sessionFor(signedOut), null);
    assert.equal((await sessionFor(otherDevice))?.id, row.id, "the other device stays signed in");
    assert.equal(accountLookup.mock.callCount(), 0, "and its account row is still the cached one");
  });

  it("does not keep a 'not revoked' answer whose read began before the sign-out", async () => {
    const row = freshStudent();
    const token = tokenFor(row);
    const release = holdLookups();
    const requestInFlight = sessionFor(token);
    await turn();

    sessionCookieValue = token;
    await auth.clearSession();
    release();
    await requestInFlight;

    assert.equal(await sessionFor(token), null);
  });
});

describe("the demo switch", () => {
  it("ends a demo session at once when the switch goes off, whatever is cached", async () => {
    process.env.COHORT_DEMO_MODE = "true";
    const row = freshStudent({ demoAccount: "student", passwordHash: null });
    const token = tokenFor(row, { demo: "student" });
    assert.equal((await sessionFor(token))?.demoAccount, "student");
    resetLookupCounts();

    delete process.env.COHORT_DEMO_MODE;

    assert.equal(await sessionFor(token), null);
    assert.equal(accountLookup.mock.callCount(), 0, "the refusal did not need a fresh read");
  });
});
