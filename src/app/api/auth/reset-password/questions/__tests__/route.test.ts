/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
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

const mockFindFirst = mock.fn() as any;
const mockTransaction = mock.fn() as any;
const mockTxUpdate = mock.fn() as any;
const mockTxDeleteMany = mock.fn() as any;
const mockRateLimit = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockVerifySecurityAnswer = mock.fn() as any;
const mockLoggerWarn = mock.fn() as any;

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => null,
    hashPassword: (password: string) => ({ hash: `scrypt$salt$hashed-${password}`, salt: "salt" }),
    normalizeStudentId: (raw: string) =>
      raw.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9@._-]/g, ""),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    setSessionCookie: async (studentId: string, role: string, sessionVersion: number) => {
      cookieSets.push({ studentId, role, sessionVersion });
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
  namedExports: { rateLimit: mockRateLimit },
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
    mockFindFirst.mock.resetCalls();
    mockTransaction.mock.resetCalls();
    mockTxUpdate.mock.resetCalls();
    mockTxDeleteMany.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockVerifySecurityAnswer.mock.resetCalls();
    mockLoggerWarn.mock.resetCalls();

    mockRateLimit.mock.mockImplementation(async () => okLimit());
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

  it("returns the generic error for an unknown account and makes no per-account limiter call", async () => {
    mockFindFirst.mock.mockImplementation(async () => null);

    const res = await questionsRoute.POST(resetRequest() as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.match(body.error, /could not verify/i);
    assert.deepEqual(limiterKeys(), [`reset-password-questions:${IP}`]);
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
    assert.equal(mockVerifySecurityAnswer.mock.callCount(), 0, "answers are not checked once locked");
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
    assert.equal(mockVerifySecurityAnswer.mock.callCount(), 0);
    assert.equal(mockTransaction.mock.callCount(), 0);
  });

  it("returns 403 for staff accounts without touching the password", async () => {
    mockFindFirst.mock.mockImplementation(async () => studentRecord({ role: "teacher" }));

    const res = await questionsRoute.POST(resetRequest() as never);

    assert.equal(res.status, 403);
    assert.equal(mockTransaction.mock.callCount(), 0);
    assert.equal(cookieSets.length, 0);
  });

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
});
