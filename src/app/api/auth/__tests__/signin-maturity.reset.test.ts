/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding intentionally loose for route harnesses */
/**
 * Sign-in maturity contract — password reset path probes.
 *
 * Goal 0 instrument: asserts the mature contract. Failures against today's
 * code are the baseline Goal 1 will turn green. Do not weaken these cases
 * to make the suite pass — freeze them once Goal 0 lands.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

const mockRateLimit = mock.fn() as any;
const mockFindFirst = mock.fn() as any;
const mockDeleteMany = mock.fn() as any;
const mockCreateToken = mock.fn() as any;
const mockSendEmail = mock.fn() as any;
const mockIsEmailConfigured = mock.fn() as any;
const mockGenerateToken = mock.fn() as any;

const mockQuestionsTransaction = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockSetSessionCookie = mock.fn() as any;
const mockValidateSecurityQuestionAnswers = mock.fn() as any;
const mockHasConfiguredSecurityQuestionSet = mock.fn() as any;
const mockVerifySecurityAnswer = mock.fn() as any;

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: mockRateLimit,
  },
});

mock.module("@/lib/auth", {
  namedExports: {
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    normalizeStudentId: (raw: string) =>
      raw.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9@._-]/g, ""),
    hashPassword: (password: string) => ({ hash: `scrypt$salt$hashed-${password}`, salt: "salt" }),
    setSessionCookie: mockSetSessionCookie,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      student: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
      passwordResetToken: {
        deleteMany: mockDeleteMany,
        create: mockCreateToken,
      },
      $transaction: mockQuestionsTransaction,
    },
    prisma: {
      student: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
      passwordResetToken: {
        deleteMany: mockDeleteMany,
        create: mockCreateToken,
      },
      $transaction: mockQuestionsTransaction,
    },
  },
});

mock.module("@/lib/password-reset", {
  namedExports: {
    generatePasswordResetToken: mockGenerateToken,
  },
});

mock.module("@/lib/email", {
  namedExports: {
    isEmailDeliveryConfigured: mockIsEmailConfigured,
    sendEmail: mockSendEmail,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

mock.module("@/lib/security-questions", {
  namedExports: {
    hasConfiguredSecurityQuestionSet: mockHasConfiguredSecurityQuestionSet,
    validateSecurityQuestionAnswers: mockValidateSecurityQuestionAnswers,
  },
});

mock.module("@/lib/security-question-auth", {
  namedExports: {
    verifySecurityAnswer: mockVerifySecurityAnswer,
  },
});

let forgotPasswordRoute: Awaited<typeof import("../forgot-password/route")>;
let resetQuestionsRoute: Awaited<typeof import("../reset-password/questions/route")>;

before(async () => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  forgotPasswordRoute = await import("../forgot-password/route");
  resetQuestionsRoute = await import("../reset-password/questions/route");
});

describe("sign-in maturity — reset paths", () => {
  beforeEach(() => {
    mockRateLimit.mock.resetCalls();
    mockFindFirst.mock.resetCalls();
    mockDeleteMany.mock.resetCalls();
    mockCreateToken.mock.resetCalls();
    mockSendEmail.mock.resetCalls();
    mockIsEmailConfigured.mock.resetCalls();
    mockGenerateToken.mock.resetCalls();
    mockQuestionsTransaction.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockSetSessionCookie.mock.resetCalls();
    mockValidateSecurityQuestionAnswers.mock.resetCalls();
    mockHasConfiguredSecurityQuestionSet.mock.resetCalls();
    mockVerifySecurityAnswer.mock.resetCalls();

    mockRateLimit.mock.mockImplementation(async () => ({
      success: true,
      remaining: 4,
      resetTime: Date.now() + 60_000,
    }));
    mockIsEmailConfigured.mock.mockImplementation(() => true);
    mockGenerateToken.mock.mockImplementation(() => ({
      token: "raw-reset-token",
      tokenHash: "hashed-reset-token",
      expiresAt: new Date(Date.now() + 3_600_000),
    }));
    mockDeleteMany.mock.mockImplementation(async () => ({ count: 0 }));
    mockCreateToken.mock.mockImplementation(async () => ({ id: "tok-1" }));
    mockSendEmail.mock.mockImplementation(async () => undefined);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockSetSessionCookie.mock.mockImplementation(async () => "jwt");
  });

  it("MATURITY: email reset is enumeration-safe (unknown login same shape as known)", async () => {
    mockFindFirst.mock.mockImplementation(async () => null);
    const unknownRes = await forgotPasswordRoute.POST(
      mockRequest("/api/auth/forgot-password", {
        method: "POST",
        body: { login: "nobody@example.com" },
      }) as never,
    );
    const unknownBody = (await unknownRes.json()) as { ok?: boolean; message?: string; error?: string };

    mockFindFirst.mock.mockImplementation(async () => ({
      id: "stu-1",
      displayName: "Alice",
      email: "alice@example.com",
    }));
    const knownRes = await forgotPasswordRoute.POST(
      mockRequest("/api/auth/forgot-password", {
        method: "POST",
        body: { login: "alice@example.com" },
      }) as never,
    );
    const knownBody = (await knownRes.json()) as { ok?: boolean; message?: string; error?: string };

    assert.equal(unknownRes.status, 200);
    assert.equal(knownRes.status, 200);
    assert.equal(unknownBody.ok, true);
    assert.equal(knownBody.ok, true);
    assert.equal(
      unknownBody.message,
      knownBody.message,
      "known vs unknown accounts must return the same generic message",
    );
  });

  it("MATURITY: email reset creates a hashed token and sends mail when configured", async () => {
    mockFindFirst.mock.mockImplementation(async () => ({
      id: "stu-1",
      displayName: "Alice",
      email: "alice@example.com",
    }));

    const res = await forgotPasswordRoute.POST(
      mockRequest("/api/auth/forgot-password", {
        method: "POST",
        body: { login: "alice@example.com" },
      }) as never,
    );
    assert.equal(res.status, 200);
    assert.equal(mockCreateToken.mock.callCount(), 1);
    const createArg = mockCreateToken.mock.calls[0].arguments[0] as {
      data: { tokenHash: string; studentId: string };
    };
    assert.equal(createArg.data.tokenHash, "hashed-reset-token");
    assert.equal(createArg.data.studentId, "stu-1");
    assert.equal(mockSendEmail.mock.callCount(), 1);
  });

  it("MATURITY: classroom-questions reset rejects with a generic error when answers are wrong", async () => {
    // Questions route uses its own student.findFirst via prismaAdmin — rebind mockFindFirst.
    mockFindFirst.mock.mockImplementation(async () => ({
      id: "stu-1",
      role: "student",
      sessionVersion: 1,
      securityQuestionAnswers: [
        { questionKey: "birth_city", answerHash: "hash-a" },
        { questionKey: "elementary_school", answerHash: "hash-b" },
        { questionKey: "favorite_teacher", answerHash: "hash-c" },
      ],
    }));
    mockHasConfiguredSecurityQuestionSet.mock.mockImplementation(() => true);
    mockValidateSecurityQuestionAnswers.mock.mockImplementation(() => ({
      answers: {
        birth_city: "tulsa",
        elementary_school: "central",
        favorite_teacher: "pat",
      },
      error: null,
    }));
    mockVerifySecurityAnswer.mock.mockImplementation(() => false);

    const res = await resetQuestionsRoute.POST(
      mockRequest("/api/auth/reset-password/questions", {
        method: "POST",
        body: {
          login: "alice",
          password: "newpassword1",
          securityQuestions: {
            birth_city: "tulsa",
            elementary_school: "central",
            favorite_teacher: "pat",
          },
        },
      }) as never,
    );
    const body = (await res.json()) as { error?: string };
    assert.equal(res.status, 400);
    assert.match(body.error || "", /could not verify|recovery/i);
    assert.equal(mockSetSessionCookie.mock.callCount(), 0);
  });

  it("MATURITY: classroom-questions reset succeeds and invalidates sessions when answers match", async () => {
    mockFindFirst.mock.mockImplementation(async () => ({
      id: "stu-1",
      role: "student",
      sessionVersion: 1,
      securityQuestionAnswers: [
        { questionKey: "birth_city", answerHash: "hash-a" },
        { questionKey: "elementary_school", answerHash: "hash-b" },
        { questionKey: "favorite_teacher", answerHash: "hash-c" },
      ],
    }));
    mockHasConfiguredSecurityQuestionSet.mock.mockImplementation(() => true);
    mockValidateSecurityQuestionAnswers.mock.mockImplementation(() => ({
      answers: {
        birth_city: "tulsa",
        elementary_school: "central",
        favorite_teacher: "pat",
      },
      error: null,
    }));
    mockVerifySecurityAnswer.mock.mockImplementation(() => true);
    mockQuestionsTransaction.mock.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = {
        student: {
          update: async () => ({
            id: "stu-1",
            role: "student",
            sessionVersion: 2,
          }),
        },
        passwordResetToken: {
          deleteMany: async () => ({ count: 0 }),
        },
      };
      return fn(tx);
    });

    const res = await resetQuestionsRoute.POST(
      mockRequest("/api/auth/reset-password/questions", {
        method: "POST",
        body: {
          login: "alice",
          password: "newpassword1",
          securityQuestions: {
            birth_city: "tulsa",
            elementary_school: "central",
            favorite_teacher: "pat",
          },
        },
      }) as never,
    );
    assert.equal(res.status, 200);
    assert.equal(mockSetSessionCookie.mock.callCount(), 1);
  });
});
