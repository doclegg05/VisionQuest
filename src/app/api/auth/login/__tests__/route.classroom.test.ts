import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { FakeLimiterStore } from "./limiter-store.fake";

// ---------------------------------------------------------------------------
// Sign-in route: a whole classroom behind one network address (readiness A1)
//
// The defect: the per-network bucket counted every sign-in, right or wrong,
// at 10 per 15 minutes and never gave a unit back. A class of 15 to 30 adult
// learners shares one address, so the eleventh student of the morning was
// told "Too many login attempts" and the class needed 30 to 45 minutes to
// get in.
//
// Decision R3: a successful sign-in does not count against the network
// address. Failed attempts are limited to 30 per address per 15 minutes. The
// per-account limit of 5 failed attempts stays as the brute-force control.
//
// Like route.concurrency.test.ts, this file leaves `@/lib/rate-limit`
// unmocked: the limiter is part of what is under test, over a fake counter
// store. The numbers below are written out, not imported from the route, so
// a changed constant fails here.
// ---------------------------------------------------------------------------

// The route keys the unknown-login limiter bucket on an HMAC under JWT_SECRET.
process.env.JWT_SECRET = "test-secret-for-login-route-limiter-keys";

const CLASSROOM_SIZE = 30;
const NETWORK_FAILED_LIMIT = 30;
const ACCOUNT_LIMIT = 5;
const CLASSROOM_ADDRESS = "203.0.113.20";
const OTHER_ADDRESS = "203.0.113.21";
const RIGHT_PASSWORD = "right-password";
const WRONG_PASSWORD = "wrong-password";

const SIGN_IN_FAILED =
  "We could not sign you in. Check your username or email and your password, then try again. " +
  "After too many tries, wait 15 minutes or ask your instructor for help.";
const ADDRESS_LIMIT_REACHED =
  "Too many sign-in tries from this location. Wait 15 minutes, then try again, or ask your instructor for help.";

interface Account {
  id: string;
  studentId: string;
  displayName: string;
  email: string;
  role: string;
  passwordHash: string | null;
  authProvider: string | null;
  isActive: boolean;
  sessionVersion: number;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
}

const roster = new Map<string, Account>();
const limiterStore = new FakeLimiterStore();

const fakeDb = {
  $queryRaw: limiterStore.$queryRaw,
  $executeRaw: limiterStore.$executeRaw,
  student: {
    findUnique: async ({ where }: { where: { studentId?: string; email?: string } }) => {
      if (where.studentId !== undefined) return roster.get(where.studentId) ?? null;
      return [...roster.values()].find((account) => account.email === where.email) ?? null;
    },
    updateMany: async () => ({ count: 1 }),
  },
};

mock.module("@/lib/db", {
  namedExports: { prismaAdmin: fakeDb, prisma: fakeDb },
});

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => null,
    // Stands in for the KDF: a stored hash matches exactly one password.
    verifyPasswordSafeWithStatus: (password: string, passwordHash: string | null) => ({
      valid: passwordHash === `hash:${password}`,
      needsRehash: false,
    }),
    hashPassword: () => ({ hash: "scrypt$newhash$value", salt: "salt" }),
    normalizeStudentId: (raw: string) => raw.trim().toLowerCase(),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    sessionCachePrimer: () => () => undefined,
    setSessionCookie: async () => "fake-jwt-token",
    signMfaSessionToken: (id: string) => `mfa-token-for-${id}`,
    setMfaSessionCookie: async () => undefined,
  },
});

mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: async () => undefined },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    requestId: () => "test-request-id",
  },
});

let loginRoute: Awaited<typeof import("../route")>;

before(async () => {
  loginRoute = await import("../route");
});

function enroll(studentId: string, overrides: Partial<Account> = {}): string {
  roster.set(studentId, {
    id: `id-${studentId}`,
    studentId,
    displayName: studentId,
    email: `${studentId}@example.com`,
    role: "student",
    passwordHash: `hash:${RIGHT_PASSWORD}`,
    authProvider: null,
    isActive: true,
    sessionVersion: 0,
    mfaEnabled: false,
    mustChangePassword: false,
    ...overrides,
  });
  return studentId;
}

/** `size` accounts named `<prefix>01`, `<prefix>02`, and so on. */
function enrollGroup(prefix: string, size: number, overrides: Partial<Account> = {}): string[] {
  return Array.from({ length: size }, (_, i) =>
    enroll(`${prefix}${String(i + 1).padStart(2, "0")}`, overrides),
  );
}

function signIn(studentId: string, password: string, address = CLASSROOM_ADDRESS): Promise<Response> {
  return loginRoute.POST(
    new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": address },
      body: JSON.stringify({ studentId, password }),
    }),
  );
}

/** One attempt per login, one after another, answering each status. */
async function statusesInTurn(logins: string[], password: string, address = CLASSROOM_ADDRESS): Promise<number[]> {
  const statuses: number[] = [];
  for (const login of logins) {
    statuses.push((await signIn(login, password, address)).status);
  }
  return statuses;
}

async function errorOf(res: Response): Promise<string> {
  const body: unknown = await res.json();
  assert.ok(typeof body === "object" && body !== null && "error" in body, "the response carries an error");
  assert.ok(typeof body.error === "string", "the error is text");
  return body.error;
}

function repeat<T>(value: T, times: number): T[] {
  return Array.from({ length: times }, () => value);
}

describe("POST /api/auth/login — a classroom on one network address", () => {
  beforeEach(() => {
    limiterStore.reset();
    roster.clear();
  });

  it("signs in 30 different accounts from one address inside one window", async () => {
    const students = enrollGroup("student", CLASSROOM_SIZE);

    const statuses = await statusesInTurn(students, RIGHT_PASSWORD);

    assert.deepEqual(statuses, repeat(200, CLASSROOM_SIZE));
  });

  it("signs in 30 different accounts that press sign in at the same moment", async () => {
    const students = enrollGroup("student", CLASSROOM_SIZE);

    const responses = await Promise.all(students.map((student) => signIn(student, RIGHT_PASSWORD)));

    assert.deepEqual(responses.map((res) => res.status), repeat(200, CLASSROOM_SIZE));
  });

  it("keeps signing students in past the thirtieth: a right password is not counted at all", async () => {
    const students = enrollGroup("student", CLASSROOM_SIZE + 15);

    const statuses = await statusesInTurn(students, RIGHT_PASSWORD);

    assert.deepEqual(statuses, repeat(200, CLASSROOM_SIZE + 15));
  });

  it("gives the unit back when the password was right and an MFA challenge follows", async () => {
    const staff = enrollGroup("teacher", NETWORK_FAILED_LIMIT + 1, { role: "teacher", mfaEnabled: true });

    const responses = [];
    for (const teacher of staff) responses.push(await signIn(teacher, RIGHT_PASSWORD));

    assert.deepEqual(responses.map((res) => res.status), repeat(200, staff.length));
    assert.deepEqual(await responses[responses.length - 1].json(), { requiresMfa: true });
  });
});

describe("POST /api/auth/login — failed attempts from one network address", () => {
  beforeEach(() => {
    limiterStore.reset();
    roster.clear();
  });

  it("answers 30 failed attempts from one address and refuses the 31st", async () => {
    const mistyped = enrollGroup("student", 16);
    const unknown = Array.from({ length: 15 }, (_, i) => `nobody${i}`);

    // One try each, so no account reaches its own limit of 5.
    const statuses = [
      ...(await statusesInTurn(mistyped.slice(0, 15), WRONG_PASSWORD)),
      ...(await statusesInTurn(unknown, WRONG_PASSWORD)),
    ];
    const thirtyFirst = await signIn(mistyped[15], WRONG_PASSWORD);

    assert.deepEqual(statuses, repeat(401, NETWORK_FAILED_LIMIT));
    assert.equal(thirtyFirst.status, 429);
  });

  it("refuses the right password too once the address has used its failed tries", async () => {
    const students = enrollGroup("student", NETWORK_FAILED_LIMIT + 1);
    await statusesInTurn(students.slice(0, NETWORK_FAILED_LIMIT), WRONG_PASSWORD);

    const res = await signIn(students[NETWORK_FAILED_LIMIT], RIGHT_PASSWORD);

    assert.equal(res.status, 429);
    assert.equal(await errorOf(res), ADDRESS_LIMIT_REACHED);
  });

  it("counts only the failed attempts when a classroom signs in between them", async () => {
    const mistyped = enrollGroup("mistyped", NETWORK_FAILED_LIMIT + 1);
    const students = enrollGroup("student", CLASSROOM_SIZE);

    const firstFailures = await statusesInTurn(mistyped.slice(0, NETWORK_FAILED_LIMIT - 1), WRONG_PASSWORD);
    const signIns = await statusesInTurn(students, RIGHT_PASSWORD);
    const lastAllowedFailure = await signIn(mistyped[NETWORK_FAILED_LIMIT - 1], WRONG_PASSWORD);
    const oneTooMany = await signIn(mistyped[NETWORK_FAILED_LIMIT], WRONG_PASSWORD);

    assert.deepEqual(firstFailures, repeat(401, NETWORK_FAILED_LIMIT - 1));
    assert.deepEqual(signIns, repeat(200, CLASSROOM_SIZE), "29 failed tries must not block the class");
    assert.equal(lastAllowedFailure.status, 401, "the 30 sign-ins left the failed-try count at 29");
    assert.equal(oneTooMany.status, 429);
  });

  it("admits exactly 30 of 40 wrong passwords sent at the same moment", async () => {
    // Each attempt takes its unit before anything else runs, so a burst
    // cannot race past the limit.
    const mistyped = enrollGroup("student", 40);

    const responses = await Promise.all(mistyped.map((student) => signIn(student, WRONG_PASSWORD)));
    const statuses = responses.map((res) => res.status);

    assert.equal(statuses.filter((status) => status === 401).length, NETWORK_FAILED_LIMIT);
    assert.equal(statuses.filter((status) => status === 429).length, 40 - NETWORK_FAILED_LIMIT);
  });

  it("leaves a second address alone when the first has used its failed tries", async () => {
    const students = enrollGroup("student", NETWORK_FAILED_LIMIT + 1);
    await statusesInTurn(students.slice(0, NETWORK_FAILED_LIMIT), WRONG_PASSWORD);

    const sameAddress = await signIn(students[NETWORK_FAILED_LIMIT], RIGHT_PASSWORD);
    const otherAddress = await signIn(students[NETWORK_FAILED_LIMIT], RIGHT_PASSWORD, OTHER_ADDRESS);

    assert.equal(sameAddress.status, 429);
    assert.equal(otherAddress.status, 200);
  });
});

describe("POST /api/auth/login — the per-account limit beside a classroom", () => {
  beforeEach(() => {
    limiterStore.reset();
    roster.clear();
  });

  it("still refuses the sixth wrong password on one account while a classmate on the same address signs in", async () => {
    enroll("alice");
    enroll("ben");

    const wrongTries = await statusesInTurn(repeat("alice", ACCOUNT_LIMIT + 1), WRONG_PASSWORD);
    const rightPasswordWhileLocked = await signIn("alice", RIGHT_PASSWORD);
    const classmate = await signIn("ben", RIGHT_PASSWORD);

    assert.deepEqual(wrongTries, repeat(401, ACCOUNT_LIMIT + 1));
    assert.equal(rightPasswordWhileLocked.status, 401, "the account stays locked even for the right password");
    assert.equal(classmate.status, 200);
  });

  it("gives a locked account the same status and body as a wrong password", async () => {
    enroll("alice");
    enroll("ben");
    await statusesInTurn(repeat("alice", ACCOUNT_LIMIT), WRONG_PASSWORD);

    const locked = await signIn("alice", RIGHT_PASSWORD);
    const wrongPassword = await signIn("ben", WRONG_PASSWORD);

    assert.equal(locked.status, 401);
    assert.equal(locked.status, wrongPassword.status);
    assert.equal(await locked.text(), await wrongPassword.text());
  });

  it("gives a locked account no unit back, so the address count cannot show whether the password was right", async () => {
    enroll("alice");
    enroll("ben");
    await statusesInTurn(repeat("alice", ACCOUNT_LIMIT), WRONG_PASSWORD);

    // 5 failed tries are counted. 25 more with the RIGHT password, all
    // refused by the account lock, must use up the rest of the 30.
    const lockedTries = await statusesInTurn(
      repeat("alice", NETWORK_FAILED_LIMIT - ACCOUNT_LIMIT),
      RIGHT_PASSWORD,
    );
    const next = await signIn("ben", RIGHT_PASSWORD);

    assert.deepEqual(lockedTries, repeat(401, NETWORK_FAILED_LIMIT - ACCOUNT_LIMIT));
    assert.equal(next.status, 429, "a refunded locked try would have left room for this sign-in");
  });
});

// ---------------------------------------------------------------------------
// One student, several lab PCs (A1 security review, required item 1)
//
// The per-account bucket counted every sign-in, right or wrong, at 5 per 15
// minutes and gave nothing back. A student who signed in on a sixth lab PC
// was refused with the wrong-password message. A right password now gives
// its per-account unit back, at the same point as the per-network unit: only
// after the response is certain to say the password was right. One unit
// comes back, never the failed tries before it.
// ---------------------------------------------------------------------------

describe("POST /api/auth/login — one student signing in on several lab PCs", () => {
  /** The per-account bucket of the account `enroll(studentId)` creates. */
  const accountKey = (studentId: string) => `login:user:id-${studentId}`;

  beforeEach(() => {
    limiterStore.reset();
    roster.clear();
  });

  it("admits six correct sign-ins in a row on one account, and then a seventh", async () => {
    enroll("alice");

    const firstSix = await statusesInTurn(repeat("alice", ACCOUNT_LIMIT + 1), RIGHT_PASSWORD);
    const seventh = await signIn("alice", RIGHT_PASSWORD);

    assert.deepEqual(firstSix, repeat(200, ACCOUNT_LIMIT + 1));
    assert.equal(seventh.status, 200);
  });

  it("holds no account unit once a correct sign-in has been answered", async () => {
    enroll("alice");

    await signIn("alice", RIGHT_PASSWORD);

    assert.equal(limiterStore.countFor(accountKey("alice")), 0);
  });

  it("gives the account unit back when the password was right and an MFA challenge follows", async () => {
    enroll("teacher", { role: "teacher", mfaEnabled: true });

    const responses = [];
    for (let i = 0; i < ACCOUNT_LIMIT + 2; i += 1) responses.push(await signIn("teacher", RIGHT_PASSWORD));

    assert.deepEqual(responses.map((res) => res.status), repeat(200, ACCOUNT_LIMIT + 2));
    assert.deepEqual(await responses[responses.length - 1].json(), { requiresMfa: true });
  });

  it("still refuses the right password after five wrong ones", async () => {
    enroll("alice");

    const wrongTries = await statusesInTurn(repeat("alice", ACCOUNT_LIMIT), WRONG_PASSWORD);
    const rightPassword = await signIn("alice", RIGHT_PASSWORD);

    assert.deepEqual(wrongTries, repeat(401, ACCOUNT_LIMIT));
    assert.equal(rightPassword.status, 401);
    assert.equal(await errorOf(rightPassword), SIGN_IN_FAILED);
  });

  it("gives back one unit for a correct sign-in, never the wrong tries before it", async () => {
    enroll("alice");

    // Four wrong tries stay counted through two correct sign-ins, so the
    // fifth wrong try is the last one admitted.
    const wrongTries = await statusesInTurn(repeat("alice", ACCOUNT_LIMIT - 1), WRONG_PASSWORD);
    const signIns = await statusesInTurn(repeat("alice", 2), RIGHT_PASSWORD);
    const fifthWrongTry = await signIn("alice", WRONG_PASSWORD);
    const rightPasswordWhileLocked = await signIn("alice", RIGHT_PASSWORD);

    assert.deepEqual(wrongTries, repeat(401, ACCOUNT_LIMIT - 1));
    assert.deepEqual(signIns, [200, 200]);
    assert.equal(fifthWrongTry.status, 401);
    assert.equal(rightPasswordWhileLocked.status, 401, "two correct sign-ins must not have cleared the four wrong tries");
  });

  it("gives a locked account nothing back, even for the right password", async () => {
    enroll("alice");
    await statusesInTurn(repeat("alice", ACCOUNT_LIMIT), WRONG_PASSWORD);

    const lockedTries = await statusesInTurn(repeat("alice", 3), RIGHT_PASSWORD);

    assert.deepEqual(lockedTries, repeat(401, 3));
    assert.equal(limiterStore.countFor(accountKey("alice")), ACCOUNT_LIMIT + 3, "every locked try stays counted");
  });

  for (const [name, overrides] of [
    ["a closed account", { isActive: false }],
    ["a Google-only account", { passwordHash: null, authProvider: "google" }],
  ] as const) {
    it(`gives ${name} nothing back`, async () => {
      enroll("alice", overrides);

      const tries = await statusesInTurn(repeat("alice", 2), RIGHT_PASSWORD);

      assert.deepEqual(tries, [401, 401]);
      assert.equal(limiterStore.countFor(accountKey("alice")), 2, "both tries stay counted");
    });
  }

  it("counts a wrong password on one account while a classmate's correct sign-ins come back", async () => {
    enroll("alice");
    enroll("ben");

    await signIn("alice", WRONG_PASSWORD);
    await statusesInTurn(repeat("ben", ACCOUNT_LIMIT + 1), RIGHT_PASSWORD);

    assert.equal(limiterStore.countFor(accountKey("alice")), 1);
    assert.equal(limiterStore.countFor(accountKey("ben")), 0);
  });
});

describe("POST /api/auth/login — what a student reads when sign-in fails", () => {
  beforeEach(() => {
    limiterStore.reset();
    roster.clear();
  });

  it("says the same plain thing for a wrong password, an unknown login, a locked, a closed and a Google-only account", async () => {
    enroll("alice");
    enroll("ben");
    enroll("closed", { isActive: false });
    enroll("google", { passwordHash: null, authProvider: "google" });
    await statusesInTurn(repeat("alice", ACCOUNT_LIMIT), WRONG_PASSWORD);

    const failures = [
      await signIn("ben", WRONG_PASSWORD),
      await signIn("nobody", WRONG_PASSWORD),
      await signIn("alice", RIGHT_PASSWORD),
      await signIn("closed", RIGHT_PASSWORD),
      await signIn("google", RIGHT_PASSWORD),
    ];

    assert.deepEqual(failures.map((res) => res.status), repeat(401, failures.length));
    assert.deepEqual(await Promise.all(failures.map(errorOf)), repeat(SIGN_IN_FAILED, failures.length));
  });

  it("tells a refused address to wait 15 minutes or ask the instructor", async () => {
    const students = enrollGroup("student", NETWORK_FAILED_LIMIT + 1);
    await statusesInTurn(students.slice(0, NETWORK_FAILED_LIMIT), WRONG_PASSWORD);

    const refused = await signIn(students[NETWORK_FAILED_LIMIT], WRONG_PASSWORD);

    assert.equal(refused.status, 429);
    assert.equal(await errorOf(refused), ADDRESS_LIMIT_REACHED);
  });

  it("keeps limiter words out of both messages", async () => {
    const students = enrollGroup("student", NETWORK_FAILED_LIMIT + 1);
    const failed = await signIn(students[0], WRONG_PASSWORD);
    await statusesInTurn(students.slice(1, NETWORK_FAILED_LIMIT), WRONG_PASSWORD);
    const refused = await signIn(students[NETWORK_FAILED_LIMIT], WRONG_PASSWORD);

    assert.deepEqual([failed.status, refused.status], [401, 429]);
    for (const message of [await errorOf(failed), await errorOf(refused)]) {
      assert.doesNotMatch(message, /rate.?limit|\bIP\b|network|address/i);
      assert.match(message, /15 minutes/);
      assert.match(message, /ask your instructor/);
    }
  });
});
