/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";
import { studentLogKey } from "@/lib/log-keys";

// ---------------------------------------------------------------------------
// Security-question password reset — request-level tests
//
// This route can set a password and issue a session from three short
// answers, so it carries the same per-IP plus per-account limits as login.
// `@/lib/security-question-auth` is stubbed to keep scrypt out of the loop;
// `@/lib/security-questions`, `@/lib/schemas`, and `@/lib/api-error` are
// real.
// ---------------------------------------------------------------------------

// The route keys the unknown-login limiter bucket on an HMAC under JWT_SECRET.
const JWT_SECRET = "test-secret-for-recovery-route-limiter-keys";
process.env.JWT_SECRET = JWT_SECRET;

const IP = "203.0.113.9";
const STUDENT = { id: "stu-1", role: "student", sessionVersion: 2 };
const ANSWERS = {
  birth_city: "Charleston",
  elementary_school: "Piedmont",
  favorite_teacher: "Emily",
};
const ANSWER_ROWS = [
  { questionKey: "birth_city", answerHash: "hash:birth_city" },
  { questionKey: "elementary_school", answerHash: "hash:elementary_school" },
  { questionKey: "favorite_teacher", answerHash: "hash:favorite_teacher" },
];

type LimiterResult = { success: boolean; remaining: number; resetTime: number; degraded: boolean };

const cookieSets: { studentId: string; role: string; sessionVersion: number }[] = [];
/** The options each session cookie was issued with, in call order. */
const cookieOptions: unknown[] = [];

const mockFindFirst = mock.fn() as any;
const mockTransaction = mock.fn() as any;
const mockTxUpdate = mock.fn() as any;
const mockTxDeleteMany = mock.fn() as any;
const mockRateLimit = mock.fn() as any;
const mockRefundRateLimit = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockVerifySecurityAnswer = mock.fn() as any;
const mockLoggerWarn = mock.fn() as any;

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => null,
    hashPassword: (password: string) => ({ hash: `scrypt$salt$hashed-${password}`, salt: "salt" }),
    invalidateSessionCache: () => undefined,
    normalizeStudentId: (raw: string) =>
      raw.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9@._-]/g, ""),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    setSessionCookie: async (studentId: string, role: string, sessionVersion: number, options: unknown) => {
      cookieSets.push({ studentId, role, sessionVersion });
      cookieOptions.push(options);
      return "fake-jwt-token";
    },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: { student: { findFirst: mockFindFirst }, $transaction: mockTransaction },
    prisma: { student: { findFirst: mockFindFirst }, $transaction: mockTransaction },
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: { rateLimit: mockRateLimit, refundRateLimit: mockRefundRateLimit },
});

mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: mockLogAuditEvent },
});

mock.module("@/lib/security-question-auth", {
  namedExports: {
    verifySecurityAnswer: mockVerifySecurityAnswer,
    hashSecurityAnswer: () => "unused",
    hashSecurityAnswers: () => [],
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: mockLoggerWarn,
      error: () => undefined,
    },
    requestId: () => "test-request",
  },
});

let questionsRoute: Awaited<typeof import("../route")>;

before(async () => {
  questionsRoute = await import("../route");
});

// --- Helpers ---------------------------------------------------------------

function okLimit(): LimiterResult {
  return { success: true, remaining: 4, resetTime: Date.now() + 60_000, degraded: false };
}

function blockedLimit(): LimiterResult {
  return { success: false, remaining: 0, resetTime: Date.now() + 60_000, degraded: false };
}

function blockLimiterWhen(predicate: (key: string) => boolean) {
  mockRateLimit.mock.mockImplementation(async (key: string) =>
    predicate(key) ? blockedLimit() : okLimit(),
  );
}

function limiterKeys(): string[] {
  return mockRateLimit.mock.calls.map((call: { arguments: [string] }) => call.arguments[0]);
}

function auditActions(): string[] {
  return mockLogAuditEvent.mock.calls.map(
    (call: { arguments: [{ action: string }] }) => call.arguments[0].action,
  );
}

/** The stored hash each answer was verified against, in call order. */
function storedHashesChecked(): unknown[] {
  return mockVerifySecurityAnswer.mock.calls.map(
    (call: { arguments: [string, unknown] }) => call.arguments[1],
  );
}

/** No stored hash: the real helper runs the KDF against auth's dummy hash. */
const DUMMY_WORK = [undefined, undefined, undefined];

function studentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: STUDENT.id,
    role: STUDENT.role,
    sessionVersion: STUDENT.sessionVersion,
    securityQuestionAnswers: ANSWER_ROWS,
    ...overrides,
  };
}

function resetRequest(overrides: Record<string, unknown> = {}) {
  return mockRequest("/api/auth/reset-password/questions", {
    method: "POST",
    body: {
      login: "alice",
      password: "a-long-new-password",
      securityQuestions: ANSWERS,
      ...overrides,
    },
    headers: { "x-forwarded-for": IP },
  });
}

// --- Tests -----------------------------------------------------------------

describe("POST /api/auth/reset-password/questions", () => {
  beforeEach(() => {
    cookieSets.length = 0;
    cookieOptions.length = 0;
    mockFindFirst.mock.resetCalls();
    mockTransaction.mock.resetCalls();
    mockTxUpdate.mock.resetCalls();
    mockTxDeleteMany.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockRefundRateLimit.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockVerifySecurityAnswer.mock.resetCalls();
    mockLoggerWarn.mock.resetCalls();

    mockRateLimit.mock.mockImplementation(async () => okLimit());
    mockRefundRateLimit.mock.mockImplementation(async () => undefined);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockVerifySecurityAnswer.mock.mockImplementation(() => true);
    mockFindFirst.mock.mockImplementation(async () => studentRecord());
    mockTxUpdate.mock.mockImplementation(async (args: { where: { id: string } }) => ({
      id: args.where.id,
      role: STUDENT.role,
      sessionVersion: STUDENT.sessionVersion + 1,
    }));
    mockTxDeleteMany.mock.mockImplementation(async () => ({ count: 0 }));
    mockTransaction.mock.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ student: { update: mockTxUpdate }, passwordResetToken: { deleteMany: mockTxDeleteMany } }),
    );
  });

  it("returns 429 on the per-IP limit before the body or the account is read", async () => {
    blockLimiterWhen((key) => key === `reset-password-questions:${IP}`);

    const res = await questionsRoute.POST(resetRequest() as never);

    assert.equal(res.status, 429);
    assert.equal(mockRateLimit.mock.callCount(), 1);
    assert.equal(mockFindFirst.mock.callCount(), 0);
    assert.equal(mockTransaction.mock.callCount(), 0);
  });

  it("returns 400 when body fails validation, without reading the account", async () => {
    const res = await questionsRoute.POST(resetRequest({ password: "short" }) as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.ok(body.error.length > 0);
    assert.equal(mockFindFirst.mock.callCount(), 0);
  });

  it("returns the generic error for an unknown account, after one per-login limiter call", async () => {
    mockFindFirst.mock.mockImplementation(async () => null);

    const res = await questionsRoute.POST(resetRequest() as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.match(body.error, /could not verify/i);
    assert.equal(limiterKeys().length, 2);
    assert.equal(limiterKeys()[0], `reset-password-questions:${IP}`);
    assert.match(limiterKeys()[1], /^reset-password-questions:unknown:[0-9a-f]{64}$/);
    assert.deepEqual(storedHashesChecked(), DUMMY_WORK, "an unknown account costs the same three checks");
    assert.equal(mockTransaction.mock.callCount(), 0);
    assert.equal(cookieSets.length, 0);
  });

  it("answers a locked account with the generic reset error, so the response does not confirm the account exists", async () => {
    mockFindFirst.mock.mockImplementation(async () => null);
    const unknownRes = await questionsRoute.POST(resetRequest() as never);
    const unknownBody = (await unknownRes.json()) as { error: string };

    mockFindFirst.mock.mockImplementation(async () => studentRecord());
    blockLimiterWhen((key) => key === `reset-password-questions:user:${STUDENT.id}`);

    const res = await questionsRoute.POST(resetRequest() as never);
    const body = (await res.json()) as { error: string };

    assert.equal(unknownRes.status, 400);
    assert.equal(res.status, 400);
    assert.deepEqual(body, unknownBody, "locked and unknown accounts get the same response");
    assert.deepEqual(
      storedHashesChecked(),
      [...DUMMY_WORK, ...DUMMY_WORK],
      "a locked account's answers are not checked; both requests spend dummy KDF work",
    );
    assert.equal(mockTransaction.mock.callCount(), 0);
    assert.equal(cookieSets.length, 0);

    // Keyed on the target account, with the route's one-hour window.
    const accountCall = mockRateLimit.mock.calls.find(
      (call: { arguments: [string] }) =>
        call.arguments[0] === `reset-password-questions:user:${STUDENT.id}`,
    );
    assert.deepEqual(accountCall?.arguments, [
      `reset-password-questions:user:${STUDENT.id}`,
      5,
      60 * 60 * 1000,
    ]);

    // An over-limit request writes nothing: the audit row and the warn log
    // are written once per window, when the last admitted attempt lands.
    assert.deepEqual(auditActions(), []);
    assert.equal(mockLoggerWarn.mock.callCount(), 0);
  });

  it("records the lockout once, when the last admitted answer attempt lands", async () => {
    mockRateLimit.mock.mockImplementation(async (key: string) =>
      key === `reset-password-questions:user:${STUDENT.id}`
        ? { success: true, remaining: 0, resetTime: Date.now() + 60_000, degraded: false }
        : okLimit(),
    );
    mockVerifySecurityAnswer.mock.mockImplementation(() => false);

    const res = await questionsRoute.POST(resetRequest() as never);

    // The last admitted guess still runs (and fails here). The lockout row is
    // written alongside it, keyed to the account, and the server log carries
    // only the correlation key.
    assert.equal(res.status, 400);
    assert.deepEqual(auditActions(), ["auth.password.reset.security_questions_locked_out"]);
    assert.equal(mockLogAuditEvent.mock.calls[0]?.arguments[0]?.targetId, STUDENT.id);
    assert.equal(mockLoggerWarn.mock.callCount(), 1);
    const [, context] = mockLoggerWarn.mock.calls[0]!.arguments as [string, Record<string, unknown>];
    assert.equal(context.student, studentLogKey(STUDENT.id));
    assert.doesNotMatch(JSON.stringify(mockLoggerWarn.mock.calls[0]!.arguments), /stu-1/);
  });

  it("answers a real account exactly like an unknown login even when the lockout audit write fails", async () => {
    // Readiness A6: the lockout row was awaited before the response, so a
    // failed write turned a real account's last attempt into a 500 while an
    // unknown login still read the generic 400, which named the account.
    mockRateLimit.mock.mockImplementation(async (key: string) =>
      key === `reset-password-questions:user:${STUDENT.id}`
        ? { success: true, remaining: 0, resetTime: Date.now() + 60_000, degraded: false }
        : { ...okLimit(), remaining: key.includes(":unknown:") ? 0 : 4 },
    );
    mockVerifySecurityAnswer.mock.mockImplementation(() => false);
    mockLogAuditEvent.mock.mockImplementation(async () => {
      throw new Error("audit store unavailable");
    });

    const real = await questionsRoute.POST(resetRequest() as never);
    mockFindFirst.mock.mockImplementation(async () => null);
    const unknown = await questionsRoute.POST(resetRequest() as never);

    assert.equal(real.status, 400);
    assert.equal(real.status, unknown.status);
    assert.deepEqual(await real.json(), await unknown.json());
    assert.deepEqual(auditActions(), ["auth.password.reset.security_questions_locked_out"], "the write was still tried");
  });

  it("counts a wrong-answer attempt against the account and returns the generic error", async () => {
    mockVerifySecurityAnswer.mock.mockImplementation(() => false);

    const res = await questionsRoute.POST(resetRequest() as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.match(body.error, /could not verify/i);
    assert.ok(
      limiterKeys().includes(`reset-password-questions:user:${STUDENT.id}`),
      "the guess is counted before the answers are checked",
    );
    assert.equal(mockTransaction.mock.callCount(), 0);
    assert.equal(cookieSets.length, 0);
  });

  it("returns the generic error when the account has no complete question set", async () => {
    mockFindFirst.mock.mockImplementation(async () =>
      studentRecord({ securityQuestionAnswers: ANSWER_ROWS.slice(0, 2) }),
    );

    const res = await questionsRoute.POST(resetRequest() as never);

    assert.equal(res.status, 400);
    assert.deepEqual(storedHashesChecked(), DUMMY_WORK);
    assert.equal(mockTransaction.mock.callCount(), 0);
    assert.equal(cookieSets.length, 0);
  });

  it("refuses staff accounts with the generic reset error, without touching the password", async () => {
    mockFindFirst.mock.mockImplementation(async () => studentRecord({ role: "teacher" }));

    const res = await questionsRoute.POST(resetRequest() as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.match(body.error, /could not verify/i);
    assert.deepEqual(storedHashesChecked(), DUMMY_WORK, "staff answers are never checked");
    assert.equal(mockTransaction.mock.callCount(), 0);
    assert.equal(cookieSets.length, 0);
  });

  it("checks every answer even after a wrong one, so timing does not show which answers matched", async () => {
    mockVerifySecurityAnswer.mock.mockImplementation(
      (_answer: string, storedHash: string) => storedHash !== "hash:birth_city",
    );

    const res = await questionsRoute.POST(resetRequest() as never);

    assert.equal(res.status, 400);
    assert.deepEqual(
      storedHashesChecked(),
      ANSWER_ROWS.map((row) => row.answerHash),
    );
    assert.equal(mockTransaction.mock.callCount(), 0);
    assert.equal(cookieSets.length, 0);
  });

  // Every refusal must cost the same three KDF runs and read the same as a
  // wrong answer on a real student account; otherwise response time or the
  // status confirms the login exists. The verifier is left answering "match"
  // so the refusal cannot be resting on the dummy hash failing.
  const refusedAccounts: { name: string; arrange: () => void }[] = [
    {
      name: "an unknown login",
      arrange: () => mockFindFirst.mock.mockImplementation(async () => null),
    },
    {
      name: "an account with no complete question set",
      arrange: () =>
        mockFindFirst.mock.mockImplementation(async () =>
          studentRecord({ securityQuestionAnswers: ANSWER_ROWS.slice(0, 2) }),
        ),
    },
    {
      name: "a staff account",
      arrange: () =>
        mockFindFirst.mock.mockImplementation(async () => studentRecord({ role: "teacher" })),
    },
    {
      name: "a locked account",
      arrange: () => blockLimiterWhen((key) => key === `reset-password-questions:user:${STUDENT.id}`),
    },
    {
      name: "an unknown login past its limit",
      arrange: () => {
        mockFindFirst.mock.mockImplementation(async () => null);
        blockLimiterWhen((key) => key.startsWith("reset-password-questions:unknown:"));
      },
    },
  ];

  for (const { name, arrange } of refusedAccounts) {
    it(`gives ${name} the same KDF work and response as a wrong answer`, async () => {
      mockVerifySecurityAnswer.mock.mockImplementation(() => false);
      const wrongRes = await questionsRoute.POST(resetRequest() as never);
      const wrongBody = await wrongRes.json();
      const wrongWork = mockVerifySecurityAnswer.mock.callCount();

      mockVerifySecurityAnswer.mock.resetCalls();
      mockVerifySecurityAnswer.mock.mockImplementation(() => true);
      arrange();
      const res = await questionsRoute.POST(resetRequest() as never);
      const body = await res.json();

      assert.equal(wrongWork, 3);
      assert.equal(res.status, wrongRes.status);
      assert.deepEqual(body, wrongBody);
      assert.deepEqual(storedHashesChecked(), DUMMY_WORK);
      assert.equal(mockTransaction.mock.callCount(), 0);
      assert.equal(cookieSets.length, 0);
    });
  }

  it("resets the password, bumps the session version, and issues a session on matching answers", async () => {
    const res = await questionsRoute.POST(resetRequest() as never);
    const body = (await res.json()) as { ok: boolean };

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(mockVerifySecurityAnswer.mock.callCount(), 3);

    const update = mockTxUpdate.mock.calls[0]?.arguments[0];
    assert.equal(update?.where?.id, STUDENT.id);
    assert.equal(update?.data?.passwordHash, "scrypt$salt$hashed-a-long-new-password");
    assert.deepEqual(update?.data?.sessionVersion, { increment: 1 });
    assert.deepEqual(mockTxDeleteMany.mock.calls[0]?.arguments[0], {
      where: { studentId: STUDENT.id },
    });

    assert.deepEqual(cookieSets, [
      { studentId: STUDENT.id, role: STUDENT.role, sessionVersion: STUDENT.sessionVersion + 1 },
    ]);
    assert.deepEqual(auditActions(), ["auth.password.reset.security_questions"]);
  });

  // Staff set a student's first password and every reset, and the account is
  // then held to the change-password screen (readiness A3). A password set
  // here is one the student chose, so the hold ends with this write, and the
  // session issued next must agree with the row or getSession() would end it.
  it("clears the must-change-password flag and issues a session that is not held", async () => {
    const res = await questionsRoute.POST(resetRequest() as never);

    assert.equal(res.status, 200);
    assert.equal(mockTxUpdate.mock.calls[0]?.arguments[0]?.data?.mustChangePassword, false);
    assert.deepEqual(cookieOptions, [{ mustChangePassword: false }]);
  });

  // --- The same limiter work for an unknown login (A1 review, item 2) -------
  //
  // The per-account limiter ran only for real accounts, so a real login was
  // answered one database round trip slower than an unknown one, and the
  // dummy KDF could not hide that. An unknown login now makes the same call,
  // keyed on an HMAC of the normalized login under the server's secret.

  /** The per-login limiter calls one request makes, after the per-network one. */
  async function perLoginLimiterCalls(login: string): Promise<[string, number, number][]> {
    mockRateLimit.mock.resetCalls();
    await questionsRoute.POST(resetRequest({ login }) as never);
    const calls: [string, number, number][] = mockRateLimit.mock.calls.map(
      (call: { arguments: [string, number, number] }) => call.arguments,
    );
    assert.equal(calls[0]?.[0], `reset-password-questions:${IP}`, "the per-network bucket is checked first");
    return calls.slice(1);
  }

  it("makes the same number of limiter calls for a real login and an unknown one", async () => {
    const real = await perLoginLimiterCalls("alice");

    mockFindFirst.mock.mockImplementation(async () => null);
    const unknown = await perLoginLimiterCalls("ghost");

    assert.deepEqual(real, [[`reset-password-questions:user:${STUDENT.id}`, 5, 60 * 60 * 1000]]);
    assert.equal(unknown.length, real.length, "an unknown login must cost the limiter round trip a real one does");
    assert.deepEqual(unknown.map(([, limit, windowMs]) => [limit, windowMs]), [[5, 60 * 60 * 1000]]);
  });

  it("keys an unknown login on an HMAC of the normalized login, under this route's own label", async () => {
    mockFindFirst.mock.mockImplementation(async () => null);

    const [[first]] = await perLoginLimiterCalls("Ghost@Example.com");
    const [[variant]] = await perLoginLimiterCalls("  ghost@example.COM ");
    const [[other]] = await perLoginLimiterCalls("ghost2@example.com");
    const digest = (label: string) =>
      createHmac("sha256", JWT_SECRET).update(`${label}:ghost@example.com`).digest("hex");

    assert.equal(first, `reset-password-questions:unknown:${digest("reset-password-questions-limiter")}`);
    assert.equal(first, variant, "case and whitespace variants of one login share one bucket");
    assert.notEqual(first, other);
    assert.ok(!first.endsWith(digest("login-limiter")), "the sign-in route's digest for the same login is a different one");
    assert.ok(!first.startsWith("reset-password-questions:user:"), "cannot collide with a real account's bucket");
    assert.ok(!first.toLowerCase().includes("ghost"), "the typed login does not reach the limiter key");
  });

  it("writes no lockout record for an unknown login on its last admitted attempt: there is no account to name", async () => {
    mockFindFirst.mock.mockImplementation(async () => null);
    mockRateLimit.mock.mockImplementation(async () => ({ ...okLimit(), remaining: 0 }));

    const res = await questionsRoute.POST(resetRequest() as never);

    assert.equal(res.status, 400);
    assert.deepEqual(auditActions(), []);
    assert.equal(mockLoggerWarn.mock.callCount(), 0);
  });

  // --- Per-network limit sized for a classroom (readiness A1) ---------------
  //
  // The per-network bucket counted every request at 5 an hour, so the sixth
  // student recovering a password in one classroom was refused. It now allows
  // 20 FAILED attempts an hour, and a recovery that worked gives its unit
  // back. The refund follows the rule sign-in follows: it happens only when
  // the response already says the answers were right. Every refusal answers
  // the same 400, so none of them may give a unit back.

  const NETWORK_KEY = `reset-password-questions:${IP}`;
  const NETWORK_RESET_TIME = 1_900_000_000_000;

  /** Gives the per-network window a known end, so a refund can be matched to it. `degraded` picks the buckets that failed open. */
  function fixNetworkWindow(options: { degraded?: (key: string) => boolean } = {}) {
    mockRateLimit.mock.mockImplementation(async (key: string) => ({
      ...okLimit(),
      resetTime: key === NETWORK_KEY ? NETWORK_RESET_TIME : NETWORK_RESET_TIME + 1,
      degraded: options.degraded?.(key) ?? false,
    }));
  }

  function refunds(): unknown[][] {
    return mockRefundRateLimit.mock.calls.map((call: { arguments: unknown[] }) => call.arguments);
  }

  it("allows one network address 20 failed recovery attempts per hour", async () => {
    await questionsRoute.POST(resetRequest() as never);

    assert.deepEqual(mockRateLimit.mock.calls[0].arguments, [NETWORK_KEY, 20, 60 * 60 * 1000]);
  });

  it("gives the network unit back, and only that unit, when the answers were right", async () => {
    fixNetworkWindow();

    const res = await questionsRoute.POST(resetRequest() as never);

    assert.equal(res.status, 200);
    assert.deepEqual(refunds(), [[NETWORK_KEY, NETWORK_RESET_TIME]]);
  });

  it("keeps the network unit for wrong answers", async () => {
    mockVerifySecurityAnswer.mock.mockImplementation(() => false);

    const res = await questionsRoute.POST(resetRequest() as never);

    assert.equal(res.status, 400);
    assert.deepEqual(refunds(), []);
  });

  it("keeps the network unit for a request that fails validation", async () => {
    const res = await questionsRoute.POST(resetRequest({ password: "short" }) as never);

    assert.equal(res.status, 400);
    assert.deepEqual(refunds(), []);
  });

  // The verifier answers "match" in each case below, and the response is
  // still the generic refusal.
  for (const { name, arrange } of refusedAccounts) {
    it(`keeps the network unit for ${name}, which the response does not tell apart`, async () => {
      arrange();

      const res = await questionsRoute.POST(resetRequest() as never);

      assert.equal(res.status, 400);
      assert.deepEqual(refunds(), []);
    });
  }

  it("keeps the network unit when the password write fails", async () => {
    mockTransaction.mock.mockImplementation(async () => {
      throw new Error("connection refused");
    });

    const res = await questionsRoute.POST(resetRequest() as never);

    assert.equal(res.status, 500);
    assert.deepEqual(refunds(), []);
  });

  it("asks the store for nothing when the per-network limiter failed open: no unit was taken", async () => {
    fixNetworkWindow({ degraded: (key) => key === NETWORK_KEY });

    const res = await questionsRoute.POST(resetRequest() as never);

    assert.equal(res.status, 200);
    assert.deepEqual(refunds(), []);
  });

  // --- A limiter outage refuses recovery (A1 review, item 3) ----------------
  //
  // The limiter fails open when its store is down. Sign-in accepts that. This
  // route sets a password and issues a session from three short answers, so
  // here an outage of the per-account limiter must refuse: with no count kept,
  // every guess would be free. No answer is checked while it is down.

  const UNAVAILABLE =
    "We cannot reset passwords this way right now. Try again in a few minutes, or ask your instructor for help.";

  /** The per-account and per-login buckets failed open; the per-network bucket still counts. */
  function failAccountLimiterOpen() {
    fixNetworkWindow({ degraded: (key) => key !== NETWORK_KEY });
  }

  it("refuses right answers when the per-account limiter is down: no password is set and no session issued", async () => {
    failAccountLimiterOpen();

    const res = await questionsRoute.POST(resetRequest() as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 503);
    assert.equal(body.error, UNAVAILABLE);
    assert.equal(mockTransaction.mock.callCount(), 0);
    assert.equal(cookieSets.length, 0);
    assert.deepEqual(storedHashesChecked(), [], "no answer is checked while guesses cannot be counted");
    assert.deepEqual(refunds(), [], "a refused attempt keeps its per-network unit");
    assert.deepEqual(auditActions(), []);
  });

  it("refuses when every limiter is down, not only the per-account one", async () => {
    fixNetworkWindow({ degraded: () => true });

    const res = await questionsRoute.POST(resetRequest() as never);

    assert.equal(res.status, 503);
    assert.equal(mockTransaction.mock.callCount(), 0);
    assert.equal(cookieSets.length, 0);
  });

  it("answers an unknown login the same way during the outage, so the refusal names no account", async () => {
    failAccountLimiterOpen();
    const realRes = await questionsRoute.POST(resetRequest() as never);
    const realBody = await realRes.json();
    const realLimiterCalls = mockRateLimit.mock.callCount();

    mockRateLimit.mock.resetCalls();
    mockFindFirst.mock.mockImplementation(async () => null);
    const unknownRes = await questionsRoute.POST(resetRequest() as never);

    assert.equal(unknownRes.status, realRes.status);
    assert.deepEqual(await unknownRes.json(), realBody);
    assert.equal(mockRateLimit.mock.callCount(), realLimiterCalls);
    assert.deepEqual(storedHashesChecked(), [], "neither request checks an answer");
  });

  it("logs the refusal without naming the student", async () => {
    failAccountLimiterOpen();

    await questionsRoute.POST(resetRequest() as never);

    assert.equal(mockLoggerWarn.mock.callCount(), 1);
    assert.doesNotMatch(JSON.stringify(mockLoggerWarn.mock.calls[0]!.arguments), /stu-1|alice/i);
  });
});
