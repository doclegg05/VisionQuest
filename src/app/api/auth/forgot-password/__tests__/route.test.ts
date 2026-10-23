import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Forgot-password route: response timing must not reveal an account.
//
// Security finding F1 (CWE-208): every caller gets the same generic message,
// but an unknown login answered after one SELECT while a real account with an
// email waited on two token writes and a full SMTP exchange first. The
// latency gap told an attacker which emails and student IDs have a
// VisionQuest account. The token writes and the send now run after the
// response (deferAfterResponse), so these tests pin that the response is
// sent while the email is still in flight, and that a failed send no longer
// answers differently from an unknown login.
//
// `@/lib/after-response` is NOT mocked. Outside a request scope Next's
// `after()` throws and the helper runs the effect at once, un-awaited, which
// is what lets these tests observe the deferred work.
// ---------------------------------------------------------------------------

const GENERIC_MESSAGE =
  "If that account has an email on file, you will receive a reset link shortly. If not, contact your program staff.";

type StudentRow = { id: string; displayName: string; email: string | null } | null;

const mockFindFirst = mock.fn<(args: unknown) => Promise<StudentRow>>();
const mockTokenDeleteMany = mock.fn<(args: { where: Record<string, unknown> }) => Promise<{ count: number }>>();
const mockTokenCreate = mock.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>();
const mockSendEmail = mock.fn<(payload: { to: string; text: string }) => Promise<void>>();
const mockRateLimit = mock.fn<() => Promise<{ success: boolean; remaining: number; resetTime: number }>>();
const mockLogError = mock.fn<(message: string, context?: Record<string, unknown>) => void>();

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      student: { findFirst: mockFindFirst },
      passwordResetToken: { deleteMany: mockTokenDeleteMany, create: mockTokenCreate },
    },
  },
});

mock.module("@/lib/email", {
  namedExports: {
    isEmailDeliveryConfigured: () => true,
    sendEmail: mockSendEmail,
  },
});

mock.module("@/lib/password-reset", {
  namedExports: {
    generatePasswordResetToken: () => ({
      token: "raw-reset-token",
      tokenHash: "hashed-reset-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }),
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: mockRateLimit,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: mockLogError,
    },
  },
});

let route: typeof import("../route");

before(async () => {
  route = await import("../route");
});

const KNOWN_STUDENT = { id: "stu-1", displayName: "Jane Doe", email: "jane.doe@example.com" };

async function post(login: string) {
  const req = mockRequest("/api/auth/forgot-password", { method: "POST", body: { login } });
  return route.POST(req as never);
}

/** Resolve with the response, or reject if the handler is still waiting after `ms`. */
async function responseWithin(pending: Promise<Response>, ms: number): Promise<Response> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no response within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Let the un-awaited deferred effect run until `done()` holds. */
async function waitFor(done: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !done(); i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(done(), "the deferred reset work never finished");
}

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    mockFindFirst.mock.resetCalls();
    mockTokenDeleteMany.mock.resetCalls();
    mockTokenCreate.mock.resetCalls();
    mockSendEmail.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockLogError.mock.resetCalls();

    mockRateLimit.mock.mockImplementation(async () => ({
      success: true,
      remaining: 4,
      resetTime: Date.now() + 60_000,
    }));
    mockFindFirst.mock.mockImplementation(async () => KNOWN_STUDENT);
    mockTokenDeleteMany.mock.mockImplementation(async () => ({ count: 0 }));
    mockTokenCreate.mock.mockImplementation(async () => ({ id: "rst-1" }));
    mockSendEmail.mock.mockImplementation(async () => undefined);
  });

  it("answers a known account before the reset email has been sent", async () => {
    let releaseSend: () => void = () => undefined;
    mockSendEmail.mock.mockImplementation(
      () => new Promise<void>((resolve) => {
        releaseSend = resolve;
      }),
    );

    const pending = post(KNOWN_STUDENT.email);
    try {
      const res = await responseWithin(pending, 1_000);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, message: GENERIC_MESSAGE });
    } finally {
      releaseSend();
    }

    // The work still happens, just after the response.
    await waitFor(() => mockSendEmail.mock.callCount() === 1);
    assert.equal(mockTokenCreate.mock.callCount(), 1);
    assert.equal(mockTokenCreate.mock.calls[0].arguments[0].data.studentId, KNOWN_STUDENT.id);
    assert.equal(mockTokenCreate.mock.calls[0].arguments[0].data.tokenHash, "hashed-reset-token");
    const email = mockSendEmail.mock.calls[0].arguments[0];
    assert.equal(email.to, KNOWN_STUDENT.email);
    assert.match(email.text, /\/reset-password\?token=raw-reset-token/);
  });

  it("answers a known account before the token writes have finished", async () => {
    let releaseDelete: () => void = () => undefined;
    mockTokenDeleteMany.mock.mockImplementation(
      () => new Promise<{ count: number }>((resolve) => {
        releaseDelete = () => resolve({ count: 0 });
      }),
    );

    const pending = post(KNOWN_STUDENT.email);
    try {
      const res = await responseWithin(pending, 1_000);
      assert.equal(res.status, 200);
      assert.equal(mockSendEmail.mock.callCount(), 0, "the response must not wait on the token writes");
    } finally {
      releaseDelete();
    }

    await waitFor(() => mockSendEmail.mock.callCount() === 1);
  });

  it("returns the same response for an unknown login, an account with no email, and a real account", async () => {
    mockFindFirst.mock.mockImplementation(async () => null);
    const unknown = await post("nobody@example.com");

    mockFindFirst.mock.mockImplementation(async () => ({ ...KNOWN_STUDENT, email: null }));
    const noEmail = await post("jdoe01");

    mockFindFirst.mock.mockImplementation(async () => KNOWN_STUDENT);
    const known = await post(KNOWN_STUDENT.email);

    const shapes = await Promise.all(
      [unknown, noEmail, known].map(async (res) => ({ status: res.status, body: await res.json() })),
    );
    for (const shape of shapes) {
      assert.deepEqual(shape, { status: 200, body: { ok: true, message: GENERIC_MESSAGE } });
    }
    await waitFor(() => mockSendEmail.mock.callCount() === 1);
  });

  it("does not start any reset work for an unknown login", async () => {
    mockFindFirst.mock.mockImplementation(async () => null);

    const res = await post("nobody@example.com");
    assert.equal(res.status, 200);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(mockTokenDeleteMany.mock.callCount(), 0);
    assert.equal(mockTokenCreate.mock.callCount(), 0);
    assert.equal(mockSendEmail.mock.callCount(), 0);
  });

  it("logs a failed send and removes its token, but still answers with the generic message", async () => {
    mockSendEmail.mock.mockImplementation(async () => {
      throw new Error("SMTP 421 jane.doe@example.com: service not available");
    });

    const res = await post(KNOWN_STUDENT.email);
    assert.equal(res.status, 200, "a send failure only happens for real accounts, so it must not change the status");
    assert.deepEqual(await res.json(), { ok: true, message: GENERIC_MESSAGE });

    await waitFor(() => mockTokenDeleteMany.mock.callCount() === 2);
    assert.equal(mockLogError.mock.callCount(), 1);
    assert.equal(mockLogError.mock.calls[0].arguments[0], "Password reset email failed");
    assert.deepEqual(mockTokenDeleteMany.mock.calls[1].arguments[0].where, {
      studentId: KNOWN_STUDENT.id,
      tokenHash: "hashed-reset-token",
    });
  });
});
