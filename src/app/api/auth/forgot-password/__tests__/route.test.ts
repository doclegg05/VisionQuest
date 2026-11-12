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

// The route keys the unknown-login limiter bucket on an HMAC under JWT_SECRET.
process.env.JWT_SECRET = "test-secret-for-forgot-password-limiter-keys";

const GENERIC_MESSAGE =
  "If that account has an email on file, you will receive a reset link shortly. If not, contact your program staff.";

type StudentRow = { id: string; displayName: string; email: string | null } | null;

const mockFindFirst = mock.fn<(args: unknown) => Promise<StudentRow>>();
const mockTokenDeleteMany = mock.fn<(args: { where: Record<string, unknown> }) => Promise<{ count: number }>>();
const mockTokenCreate = mock.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>();
const mockSendEmail = mock.fn<(payload: { to: string; text: string }) => Promise<void>>();
type LimiterResult = { success: boolean; remaining: number; resetTime: number; degraded: boolean };
const mockRateLimit = mock.fn<(key: string, limit: number, windowMs: number) => Promise<LimiterResult>>();
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

const ADDRESS = "203.0.113.30";

async function post(login: string) {
  const req = mockRequest("/api/auth/forgot-password", {
    method: "POST",
    body: { login },
    headers: { "x-forwarded-for": `${ADDRESS}, 172.70.1.9` },
  });
  return route.POST(req as never);
}

function admitted(): LimiterResult {
  return { success: true, remaining: 4, resetTime: Date.now() + 60_000, degraded: false };
}

/** Refuses the buckets `predicate` names and admits the rest. */
function refuseLimiterWhen(predicate: (key: string) => boolean) {
  mockRateLimit.mock.mockImplementation(async (key: string) => ({
    ...admitted(),
    success: !predicate(key),
  }));
}

/** Every limiter call the route made, as [key, limit, windowMs]. */
function limiterCalls(): Array<[string, number, number]> {
  return mockRateLimit.mock.calls.map((call) => call.arguments);
}

/** Lets any un-awaited deferred work start, for tests that expect none. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
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

    mockRateLimit.mock.mockImplementation(async () => admitted());
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

  // --- Limits sized for a classroom (readiness A1) ---------------------------
  //
  // The only limit here was 5 requests per network address per 15 minutes, so
  // the sixth student asking for a reset link in one classroom was refused,
  // and nothing limited how many emails one account could be sent. The
  // per-network ceiling is now 30, and each account gets at most 3 reset
  // emails an hour whatever address asks.

  it("allows one network address 30 reset requests per 15 minutes", async () => {
    await post(KNOWN_STUDENT.email);

    assert.deepEqual(limiterCalls()[0], [`forgot-password:${ADDRESS}`, 30, 15 * 60 * 1000]);
    await waitFor(() => mockSendEmail.mock.callCount() === 1);
  });

  it("refuses with 429 once the address has used its requests, before any lookup", async () => {
    refuseLimiterWhen((key) => key === `forgot-password:${ADDRESS}`);

    const res = await post(KNOWN_STUDENT.email);
    await settle();

    assert.equal(res.status, 429);
    assert.equal(mockFindFirst.mock.callCount(), 0);
    assert.equal(mockSendEmail.mock.callCount(), 0);
  });

  it("allows one account 3 reset emails per hour, keyed on the account and not the address", async () => {
    await post(KNOWN_STUDENT.email);

    assert.deepEqual(limiterCalls()[1], [`forgot-password:user:${KNOWN_STUDENT.id}`, 3, 60 * 60 * 1000]);
    await waitFor(() => mockSendEmail.mock.callCount() === 1);
  });

  it("sends nothing once the account has had its emails, and answers exactly as it does for a sent one", async () => {
    const sent = await post(KNOWN_STUDENT.email);
    await waitFor(() => mockSendEmail.mock.callCount() === 1);
    mockSendEmail.mock.resetCalls();
    mockTokenDeleteMany.mock.resetCalls();
    mockTokenCreate.mock.resetCalls();
    refuseLimiterWhen((key) => key.startsWith("forgot-password:user:"));

    const limited = await post(KNOWN_STUDENT.email);
    await settle();

    assert.equal(limited.status, sent.status);
    assert.deepEqual(await limited.json(), await sent.json());
    assert.equal(mockSendEmail.mock.callCount(), 0);
    assert.equal(mockTokenDeleteMany.mock.callCount(), 0, "a live reset link must not be cancelled by a refused request");
    assert.equal(mockTokenCreate.mock.callCount(), 0);
  });

  it("does the same limiter work for an unknown login, an account with no email and a real account", async () => {
    const shapes: Array<Array<[number, number]>> = [];
    for (const row of [null, { ...KNOWN_STUDENT, email: null }, KNOWN_STUDENT]) {
      mockRateLimit.mock.resetCalls();
      mockFindFirst.mock.mockImplementation(async () => row);
      await post("jdoe01");
      shapes.push(limiterCalls().map(([, limit, windowMs]) => [limit, windowMs]));
    }

    const oneRequest = [
      [30, 15 * 60 * 1000],
      [3, 60 * 60 * 1000],
    ];
    assert.deepEqual(shapes, [oneRequest, oneRequest, oneRequest]);
    await waitFor(() => mockSendEmail.mock.callCount() === 1);
  });

  it("keys an unknown login on a keyed digest, never on the typed login or a real account's bucket", async () => {
    mockFindFirst.mock.mockImplementation(async () => null);
    const targetKey = async (login: string) => {
      mockRateLimit.mock.resetCalls();
      await post(login);
      return limiterCalls()[1][0];
    };

    const first = await targetKey("Ghost@Example.com");
    const variant = await targetKey("  ghost@example.COM ");
    const other = await targetKey("ghost2@example.com");

    assert.equal(first, variant, "case and whitespace variants of one login share one bucket");
    assert.notEqual(first, other);
    assert.match(first, /^forgot-password:unknown:[0-9a-f]{64}$/);
    assert.ok(!first.toLowerCase().includes("ghost"), "the typed login does not reach the limiter key");
  });

  it("keeps one budget for an account whether it is named by email or by student ID", async () => {
    await post(KNOWN_STUDENT.email);
    const byEmail = limiterCalls()[1][0];
    mockRateLimit.mock.resetCalls();
    await post("jdoe01");
    const byStudentId = limiterCalls()[1][0];

    assert.equal(byEmail, byStudentId);
    await waitFor(() => mockSendEmail.mock.callCount() === 2);
  });
});
