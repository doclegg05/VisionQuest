import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { FakeLimiterStore } from "@/app/api/auth/login/__tests__/limiter-store.fake";
import { DEMO_CREDENTIALS_REFUSAL } from "@/lib/demo/copy";
import { MIN_PASSWORD_LENGTH, STUDENT_PASSWORD_TOO_SHORT_MESSAGE } from "@/lib/password-policy";

// ---------------------------------------------------------------------------
// POST /api/settings/password: a signed-in student changes their own password
// (readiness A3).
//
// Staff set a student's first password and every reset, so until the student
// changes it a staff member knows it. This route is the way out of that, and
// the one write a session held to the change-password screen may make.
//
// `@/lib/rate-limit` is NOT mocked: the limiter runs over a fake counter
// store, and the sign-in route is loaded beside this one, so the tests can
// show the two routes spending ONE per-account budget. The numbers are
// written out, not imported, so a changed constant fails here.
// ---------------------------------------------------------------------------

// The sign-in route keys its unknown-login limiter bucket on an HMAC under JWT_SECRET.
process.env.JWT_SECRET = "test-secret-for-change-password-route-suite";

const ACCOUNT_LIMIT = 5;
const ACCOUNT_KEY = "login:user:stu-1";
const ADDRESS = "203.0.113.40";
const OLD_PASSWORD = "the-old-password";
const NEW_PASSWORD = "a brand new one";

interface Account {
  id: string;
  studentId: string;
  displayName: string;
  email: string | null;
  role: string;
  passwordHash: string | null;
  authProvider: string | null;
  isActive: boolean;
  sessionVersion: number;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  demoAccount: "student" | "instructor" | null;
}

interface TestSession {
  id: string;
  studentId: string;
  displayName: string;
  role: string;
  demoAccount?: "student" | "instructor";
  mustChangePassword?: true;
}

interface StudentUpdate {
  where: { id: string; passwordHash?: string | null; sessionVersion?: number };
  data: { passwordHash?: string; mustChangePassword?: boolean; sessionVersion?: { increment: number } };
}

const limiterStore = new FakeLimiterStore();
let account: Account;
let session: TestSession | null;
/** Runs once, between this route reading the account and writing it. */
let betweenReadAndWrite: (() => void) | null = null;

const verifyCalls: { password: string; stored: string | null }[] = [];
const hashCalls: string[] = [];
const cookieCalls: unknown[][] = [];
const cacheInvalidations: string[] = [];
const updateCalls: StudentUpdate[] = [];
const tokenDeletes: unknown[] = [];
const auditEvents: { action: string; actorId?: string | null; targetId?: string; summary?: string; metadata?: unknown }[] = [];
/** When set, the audit table refuses the next write, as it would if it were unreachable. */
let auditStoreDown = false;
const logLines: unknown[][] = [];

// The real `tryLogAuditEvent` runs, over a fake audit table: what is under
// test is that the route uses the helper that cannot fail a finished request.
const auditDb = {
  auditLog: {
    create: async ({ data }: { data: (typeof auditEvents)[number] }) => {
      if (auditStoreDown) throw new Error("audit table unreachable");
      auditEvents.push(data);
      return data;
    },
  },
};

const fakeDb = {
  $queryRaw: limiterStore.$queryRaw,
  $executeRaw: limiterStore.$executeRaw,
  student: {
    findUnique: async ({ where }: { where: { id?: string; studentId?: string; email?: string } }) => {
      const found =
        where.id === account.id || where.studentId === account.studentId || (where.email && where.email === account.email);
      if (!found) return null;
      const row = { ...account };
      betweenReadAndWrite?.();
      betweenReadAndWrite = null;
      return row;
    },
    // A conditional write, as Postgres runs it: nothing changes unless every
    // column in `where` still holds the value the caller read.
    updateMany: async (args: StudentUpdate) => {
      updateCalls.push(args);
      const { where, data } = args;
      if (where.id !== account.id) return { count: 0 };
      if ("passwordHash" in where && where.passwordHash !== account.passwordHash) return { count: 0 };
      if ("sessionVersion" in where && where.sessionVersion !== account.sessionVersion) return { count: 0 };
      account = {
        ...account,
        passwordHash: data.passwordHash ?? account.passwordHash,
        mustChangePassword: data.mustChangePassword ?? account.mustChangePassword,
        sessionVersion: account.sessionVersion + (data.sessionVersion?.increment ?? 0),
      };
      return { count: 1 };
    },
  },
  passwordResetToken: {
    deleteMany: async (args: unknown) => {
      tokenDeletes.push(args);
      return { count: 2 };
    },
  },
  $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(fakeDb),
  auditLog: auditDb.auditLog,
};

mock.module("@/lib/db", { namedExports: { prismaAdmin: fakeDb, prisma: fakeDb } });

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => session,
    // Stands in for the KDF: a stored hash matches exactly one password.
    verifyPasswordSafeWithStatus: (password: string, stored: string | null) => {
      verifyCalls.push({ password, stored });
      return { valid: stored === `hash:${password}`, needsRehash: false };
    },
    hashPassword: (password: string) => {
      hashCalls.push(password);
      return { hash: `hash:${password}`, salt: "salt" };
    },
    invalidateSessionCache: (id: string) => {
      cacheInvalidations.push(id);
    },
    setSessionCookie: async (...args: unknown[]) => {
      cookieCalls.push(args);
      return "fake-jwt-token";
    },
    normalizeStudentId: (raw: string) => raw.trim().toLowerCase(),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    signMfaSessionToken: (id: string) => `mfa-token-for-${id}`,
    setMfaSessionCookie: async () => undefined,
  },
});


const record = (...args: unknown[]) => {
  logLines.push(args);
};
mock.module("@/lib/logger", {
  namedExports: { logger: { debug: record, info: record, warn: record, error: record }, requestId: () => "test-request-id" },
});

let changeRoute: Awaited<typeof import("./route")>;
let loginRoute: Awaited<typeof import("@/app/api/auth/login/route")>;

before(async () => {
  changeRoute = await import("./route");
  loginRoute = await import("@/app/api/auth/login/route");
});

beforeEach(() => {
  limiterStore.reset();
  betweenReadAndWrite = null;
  auditStoreDown = false;
  for (const list of [verifyCalls, hashCalls, cookieCalls, cacheInvalidations, updateCalls, tokenDeletes, auditEvents, logLines]) {
    list.length = 0;
  }
  account = {
    id: "stu-1",
    studentId: "tanesha",
    displayName: "Tanesha",
    email: "tanesha@example.com",
    role: "student",
    passwordHash: `hash:${OLD_PASSWORD}`,
    authProvider: null,
    isActive: true,
    sessionVersion: 4,
    mfaEnabled: false,
    mustChangePassword: true,
    demoAccount: null,
  };
  session = { id: "stu-1", studentId: "tanesha", displayName: "Tanesha", role: "student", mustChangePassword: true };
});

function change(body: unknown): Promise<Response> {
  return changeRoute.POST(
    new NextRequest("http://localhost:3000/api/settings/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ADDRESS },
      body: JSON.stringify(body),
    }),
  );
}

function changeWith(currentPassword: string, newPassword: string = NEW_PASSWORD): Promise<Response> {
  return change({ currentPassword, newPassword });
}

function signIn(password: string): Promise<Response> {
  return loginRoute.POST(
    new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ADDRESS },
      body: JSON.stringify({ studentId: "tanesha", password }),
    }),
  );
}

async function bodyOf(res: Response): Promise<{ error?: string; code?: string; success?: boolean; data?: unknown }> {
  const body: unknown = await res.json();
  assert.ok(typeof body === "object" && body !== null, "the response is a JSON object");
  return body;
}

/** Nothing was written and no session was issued. */
function assertNothingChanged(): void {
  assert.equal(account.passwordHash, `hash:${OLD_PASSWORD}`, "the stored password must not change");
  assert.equal(account.sessionVersion, 4, "the session version must not change");
  assert.equal(account.mustChangePassword, true, "the flag must not clear");
  assert.equal(cookieCalls.length, 0, "no session cookie may be issued");
  assert.equal(tokenDeletes.length, 0, "no reset tokens may be deleted");
}

describe("POST /api/settings/password: a right current password", () => {
  it("sets the new password, clears the flag and bumps the session version in one conditional write", async () => {
    const res = await changeWith(OLD_PASSWORD);

    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), { success: true, data: { changed: true } });
    assert.equal(updateCalls.length, 1);
    assert.deepEqual(updateCalls[0], {
      where: { id: "stu-1", passwordHash: `hash:${OLD_PASSWORD}`, sessionVersion: 4 },
      data: { passwordHash: `hash:${NEW_PASSWORD}`, mustChangePassword: false, sessionVersion: { increment: 1 } },
    });
    assert.equal(account.passwordHash, `hash:${NEW_PASSWORD}`);
    assert.equal(account.mustChangePassword, false);
    assert.equal(account.sessionVersion, 5);
  });

  it("reissues the session cookie for the new version, not held, and drops the cached session", async () => {
    await changeWith(OLD_PASSWORD);

    assert.deepEqual(cookieCalls, [["stu-1", "student", 5, { mustChangePassword: false }]]);
    assert.deepEqual(cacheInvalidations, ["stu-1"]);
  });

  it("deletes the student's pending reset links", async () => {
    await changeWith(OLD_PASSWORD);

    assert.deepEqual(tokenDeletes, [{ where: { studentId: "stu-1" } }]);
  });

  it("checks the current password with the helper sign-in uses", async () => {
    await changeWith(OLD_PASSWORD);

    assert.deepEqual(verifyCalls, [{ password: OLD_PASSWORD, stored: `hash:${OLD_PASSWORD}` }]);
  });

  it("takes nothing from the sign-in budget", async () => {
    await changeWith(OLD_PASSWORD);

    assert.equal(limiterStore.countFor(ACCOUNT_KEY), 0);
  });

  it("writes one audit row, with no password in it", async () => {
    await changeWith(OLD_PASSWORD);

    assert.deepEqual(auditEvents.map((event) => event.action), ["auth.password.change"]);
    assert.equal(auditEvents[0]?.actorId, "stu-1");
    assert.equal(auditEvents[0]?.targetId, "stu-1");
    const written = JSON.stringify(auditEvents);
    assert.equal(written.includes(OLD_PASSWORD), false);
    assert.equal(written.includes(NEW_PASSWORD), false);
  });

  // The password is already changed and the cookie already reissued when the
  // audit row is written. Answering 500 then would tell the student it failed:
  // they would try again with a current password that is no longer current,
  // and spend their budget on it.
  it("still answers 200 when the audit row cannot be written: the password did change", async () => {
    auditStoreDown = true;

    const res = await changeWith(OLD_PASSWORD);

    assert.equal(res.status, 200);
    assert.deepEqual(await bodyOf(res), { success: true, data: { changed: true } });
    assert.equal(account.passwordHash, `hash:${NEW_PASSWORD}`);
    assert.deepEqual(cookieCalls, [["stu-1", "student", 5, { mustChangePassword: false }]]);
    assert.equal(auditEvents.length, 0);
  });

  it("works the same for a student who is not held: the Settings page uses this route too", async () => {
    account = { ...account, mustChangePassword: false };
    session = { id: "stu-1", studentId: "tanesha", displayName: "Tanesha", role: "student" };

    const res = await changeWith(OLD_PASSWORD);

    assert.equal(res.status, 200);
    assert.equal(account.passwordHash, `hash:${NEW_PASSWORD}`);
    assert.deepEqual(cookieCalls, [["stu-1", "student", 5, { mustChangePassword: false }]]);
  });
});

describe("POST /api/settings/password: a wrong current password", () => {
  it("answers 400 with a code, and changes nothing", async () => {
    const res = await changeWith("not-the-password");
    const body = await bodyOf(res);

    assert.equal(res.status, 400);
    assert.equal(body.code, "WRONG_CURRENT_PASSWORD");
    assert.match(body.error ?? "", /not the password you use now/i);
    assert.equal(updateCalls.length, 0);
    assert.equal(hashCalls.length, 0);
    assertNothingChanged();
  });

  it("spends one unit of the sign-in budget and gives nothing back", async () => {
    await changeWith("not-the-password");

    assert.equal(limiterStore.countFor(ACCOUNT_KEY), 1);
  });

  it("still answers the wrong password as wrong when the audit row cannot be written", async () => {
    auditStoreDown = true;

    const res = await changeWith("not-the-password");

    assert.equal(res.status, 400);
    assert.equal((await bodyOf(res)).code, "WRONG_CURRENT_PASSWORD");
  });

  it("writes an audit row for the failed try, with no password in it", async () => {
    await changeWith("not-the-password");

    assert.deepEqual(auditEvents.map((event) => event.action), ["auth.password.change_failed"]);
    assert.equal(JSON.stringify(auditEvents).includes("not-the-password"), false);
  });

  it("keeps the wrong tries when a right one follows: one unit comes back, never the ones before it", async () => {
    for (let i = 0; i < ACCOUNT_LIMIT - 1; i += 1) await changeWith(`wrong-${i}`);
    assert.equal(limiterStore.countFor(ACCOUNT_KEY), ACCOUNT_LIMIT - 1);

    const res = await changeWith(OLD_PASSWORD);

    assert.equal(res.status, 200);
    assert.equal(limiterStore.countFor(ACCOUNT_KEY), ACCOUNT_LIMIT - 1);
  });
});

describe("POST /api/settings/password: the spent budget", () => {
  it("answers 429 in plain words after five wrong tries, even to the right password", async () => {
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) assert.equal((await changeWith(`wrong-${i}`)).status, 400);
    verifyCalls.length = 0;

    const res = await changeWith(OLD_PASSWORD);
    const body = await bodyOf(res);

    assert.equal(res.status, 429);
    assert.equal(body.error, "Too many wrong tries. Wait 15 minutes, then try again. Or ask your instructor for help.");
    assert.equal(verifyCalls.length, 0, "a refused try must not check the password at all");
    assertNothingChanged();
  });

  it("keeps the unit a refused try took, whatever the password was", async () => {
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) await changeWith(`wrong-${i}`);

    await changeWith(OLD_PASSWORD);

    assert.equal(limiterStore.countFor(ACCOUNT_KEY), ACCOUNT_LIMIT + 1);
  });

  it("is the budget failed sign-ins spend: five of those close this route too", async () => {
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) assert.equal((await signIn(`wrong-${i}`)).status, 401);

    const res = await changeWith(OLD_PASSWORD);

    assert.equal(res.status, 429);
    assertNothingChanged();
  });

  it("is one count across both routes: three wrong tries here and two failed sign-ins spend it", async () => {
    for (let i = 0; i < 3; i += 1) await changeWith(`wrong-${i}`);
    for (let i = 0; i < 2; i += 1) await signIn(`wrong-${i}`);
    assert.equal(limiterStore.countFor(ACCOUNT_KEY), ACCOUNT_LIMIT);

    assert.equal((await changeWith(OLD_PASSWORD)).status, 429);
  });

  it("closes sign-in as well: five wrong tries here lock the account's sign-in for the window", async () => {
    for (let i = 0; i < ACCOUNT_LIMIT; i += 1) await changeWith(`wrong-${i}`);

    assert.equal((await signIn(OLD_PASSWORD)).status, 401);
  });

  it("refuses with 503 and checks nothing while the limiter cannot count", async () => {
    limiterStore.queuedFailures = [new Error("counter store down")];

    const res = await changeWith(OLD_PASSWORD);

    assert.equal(res.status, 503);
    assert.match((await bodyOf(res)).error ?? "", /cannot change passwords right now/i);
    assert.equal(verifyCalls.length, 0, "an attempt that cannot be counted must not be checked");
    assertNothingChanged();
  });
});

describe("POST /api/settings/password: the new password", () => {
  it("refuses one equal to the current password, and writes nothing", async () => {
    const res = await changeWith(OLD_PASSWORD, OLD_PASSWORD);
    const body = await bodyOf(res);

    assert.equal(res.status, 400);
    assert.equal(body.code, "SAME_AS_CURRENT_PASSWORD");
    assert.equal(updateCalls.length, 0);
    assertNothingChanged();
  });

  it("gives the unit back when the new password is refused: the current one was right", async () => {
    await changeWith(OLD_PASSWORD, OLD_PASSWORD);

    assert.equal(limiterStore.countFor(ACCOUNT_KEY), 0);
  });

  it("never compares the new password to the stored hash: that would test guesses for free", async () => {
    await changeWith("not-the-password", OLD_PASSWORD);

    assert.deepEqual(
      verifyCalls.map((call) => call.password),
      ["not-the-password"],
      "only the current-password field is ever checked against the hash",
    );
  });

  it("refuses one that contains the student's login id, in any case", async () => {
    for (const newPassword of ["tanesha likes lamps", "my TANESHA password", "xxTaNeShAxx-2026"]) {
      const res = await changeWith(OLD_PASSWORD, newPassword);
      const body = await bodyOf(res);

      assert.equal(res.status, 400, newPassword);
      assert.equal(body.code, "PASSWORD_CONTAINS_LOGIN", newPassword);
    }
    assert.equal(updateCalls.length, 0);
    assertNothingChanged();
  });

  it("refuses a short one in the student's words, before the budget or the password is touched", async () => {
    const res = await changeWith(OLD_PASSWORD, "a".repeat(MIN_PASSWORD_LENGTH - 1));

    assert.equal(res.status, 400);
    assert.equal((await bodyOf(res)).error, STUDENT_PASSWORD_TOO_SHORT_MESSAGE);
    assert.equal(verifyCalls.length, 0);
    assert.equal(limiterStore.countFor(ACCOUNT_KEY), 0);
    assertNothingChanged();
  });

  it("refuses a body with no current password, before the budget is touched", async () => {
    for (const body of [{ newPassword: NEW_PASSWORD }, { currentPassword: "   ", newPassword: NEW_PASSWORD }, {}, "text"]) {
      assert.equal((await change(body)).status, 400);
    }
    assert.equal(limiterStore.countFor(ACCOUNT_KEY), 0);
    assert.equal(verifyCalls.length, 0);
  });
});

describe("POST /api/settings/password: trimming, as sign-in trims", () => {
  it("checks the current password trimmed", async () => {
    const res = await changeWith(`  ${OLD_PASSWORD} \n`);

    assert.equal(res.status, 200);
    assert.deepEqual(verifyCalls.map((call) => call.password), [OLD_PASSWORD]);
  });

  it("hashes the new password trimmed, the same value the rules were checked on", async () => {
    await changeWith(OLD_PASSWORD, `  ${NEW_PASSWORD} \n`);

    assert.deepEqual(hashCalls, [NEW_PASSWORD]);
    assert.equal(account.passwordHash, `hash:${NEW_PASSWORD}`);
  });

  it("refuses a new password that differs from the current one only by spaces around it", async () => {
    const res = await changeWith(OLD_PASSWORD, `  ${OLD_PASSWORD}  `);

    assert.equal(res.status, 400);
    assert.equal((await bodyOf(res)).code, "SAME_AS_CURRENT_PASSWORD");
  });

  it("refuses a new password that only reaches the length by ending in spaces", async () => {
    const res = await changeWith(OLD_PASSWORD, `${"a".repeat(MIN_PASSWORD_LENGTH - 1)}   `);

    assert.equal(res.status, 400);
    assert.equal(hashCalls.length, 0);
  });
});

describe("POST /api/settings/password: a concurrent staff reset", () => {
  it("is never overwritten: the write is refused and the reset stands", async () => {
    // An instructor's reset lands after this route read the account and
    // before it writes: a new hash, a bumped version, and the flag set.
    betweenReadAndWrite = () => {
      account = { ...account, passwordHash: "hash:set-by-the-instructor", sessionVersion: 5, mustChangePassword: true };
    };

    const res = await changeWith(OLD_PASSWORD);
    const body = await bodyOf(res);

    assert.equal(res.status, 409);
    assert.equal(body.code, "PASSWORD_CHANGED_ELSEWHERE");
    assert.equal(updateCalls.length, 1, "the write was attempted, and matched no row");
    assert.equal(account.passwordHash, "hash:set-by-the-instructor");
    assert.equal(account.sessionVersion, 5);
    assert.equal(account.mustChangePassword, true);
    assert.equal(cookieCalls.length, 0);
    assert.equal(tokenDeletes.length, 0, "the reset's own token cleanup already ran; this route deletes nothing");
    assert.deepEqual(auditEvents.map((event) => event.action), []);
  });

  it("is not overwritten when only the session version moved", async () => {
    betweenReadAndWrite = () => {
      account = { ...account, sessionVersion: 9 };
    };

    const res = await changeWith(OLD_PASSWORD);

    assert.equal(res.status, 409);
    assert.equal(account.passwordHash, `hash:${OLD_PASSWORD}`);
    assert.equal(account.sessionVersion, 9);
  });
});

describe("POST /api/settings/password: who may use it", () => {
  it("refuses a demo account before anything is read", async () => {
    session = { id: "stu-1", studentId: "tanesha", displayName: "Tanesha", role: "student", demoAccount: "student" };

    const res = await changeWith(OLD_PASSWORD);

    assert.equal(res.status, 403);
    assert.equal((await bodyOf(res)).error, DEMO_CREDENTIALS_REFUSAL);
    assert.equal(verifyCalls.length, 0);
    assert.equal(limiterStore.countFor(ACCOUNT_KEY), 0);
    assertNothingChanged();
  });

  it("refuses the shared demo instructor the same way", async () => {
    session = { id: "stu-1", studentId: "demo", displayName: "Demo", role: "teacher", demoAccount: "instructor" };

    const res = await changeWith(OLD_PASSWORD);

    assert.equal(res.status, 403);
    assert.equal((await bodyOf(res)).error, DEMO_CREDENTIALS_REFUSAL);
  });

  it("refuses staff: this route is for student accounts", async () => {
    for (const role of ["teacher", "admin", "coordinator"]) {
      session = { id: "stu-1", studentId: "tanesha", displayName: "Tanesha", role };

      const res = await changeWith(OLD_PASSWORD);

      assert.equal(res.status, 403, role);
    }
    assert.equal(verifyCalls.length, 0);
    assertNothingChanged();
  });

  it("answers 401 with no session", async () => {
    session = null;

    assert.equal((await changeWith(OLD_PASSWORD)).status, 401);
    assert.equal(verifyCalls.length, 0);
  });

  it("refuses an account that has no password, without spending the budget", async () => {
    account = { ...account, passwordHash: null };

    const res = await changeWith(OLD_PASSWORD);

    assert.equal(res.status, 400);
    assert.equal((await bodyOf(res)).code, "NO_PASSWORD_SET");
    assert.equal(limiterStore.countFor(ACCOUNT_KEY), 0);
    assert.equal(updateCalls.length, 0);
  });
});

describe("POST /api/settings/password: what it never writes down", () => {
  it("puts no password and no student id in a log line, on any path", async () => {
    await changeWith(OLD_PASSWORD);
    await changeWith("not-the-password");
    limiterStore.queuedFailures = [new Error("counter store down")];
    await changeWith(NEW_PASSWORD, "another new one");
    // The audit table is down: the failure is logged, and names nobody.
    auditStoreDown = true;
    await changeWith("not-the-password");
    await changeWith(NEW_PASSWORD, "another new one");
    assert.ok(JSON.stringify(logLines).includes("audit_write_failed"), "the audit failure must be logged");

    const written = JSON.stringify(logLines);
    for (const secret of [OLD_PASSWORD, NEW_PASSWORD, "not-the-password", "another new one", "stu-1", "tanesha"]) {
      assert.equal(written.includes(secret), false, `a log line holds ${JSON.stringify(secret)}`);
    }
  });

  it("puts no password in any response", async () => {
    const responses = [
      await changeWith("not-the-password"),
      await changeWith(OLD_PASSWORD, OLD_PASSWORD),
      await changeWith(OLD_PASSWORD, "tanesha likes lamps"),
      await changeWith(OLD_PASSWORD),
    ];

    for (const res of responses) {
      const text = JSON.stringify(await res.json());
      for (const secret of [OLD_PASSWORD, NEW_PASSWORD, "not-the-password", "tanesha likes lamps"]) {
        assert.equal(text.includes(secret), false, `a response holds ${JSON.stringify(secret)}`);
      }
    }
  });
});
