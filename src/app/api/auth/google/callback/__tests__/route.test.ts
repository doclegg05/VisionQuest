/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";
import { studentLogKey } from "@/lib/log-keys";

// ---------------------------------------------------------------------------
// Google OAuth callback — request-level tests
//
// Review finding F9 / SEC-01 (2026-09-01): the callback issued a full session
// with no MFA challenge, never read `email_verified`, and linked to any
// existing account by email.
//
// Strategy mirrors login/__tests__/route.test.ts: `@/lib/auth` is mocked so
// the session and MFA-challenge cookie setters are spies; Prisma is mocked;
// `google-auth-library` is replaced with a verifier that returns whatever
// payload the test sets; `fetch` is stubbed for the code-for-token exchange;
// `next/headers` cookies() serves the oauth-state cookie the route compares.
// ---------------------------------------------------------------------------

const STATE = "a".repeat(64);
const GOOGLE_SUB = "google-sub-1234567890";
const OTHER_GOOGLE_SUB = "google-sub-0987654321";
const GOOGLE_EMAIL = "Teacher@Example.com";

type CookieRecord = { studentId: string; role: string; sessionVersion: number };
const cookieSets: CookieRecord[] = [];
const mfaCookieSets: string[] = [];

// The payload the mocked Google verifier hands back. Tests set it per case.
let tokenPayload: Record<string, unknown> | null = null;

const mockFindUnique = mock.fn() as any;
const mockFindFirst = mock.fn() as any;
const mockCreate = mock.fn() as any;
const mockUpdate = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockLoggerInfo = mock.fn() as any;
const mockLoggerWarn = mock.fn() as any;
const mockLoggerError = mock.fn() as any;

mock.module("@/lib/auth", {
  namedExports: {
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    setSessionCookie: async (studentId: string, role: string, sessionVersion: number) => {
      cookieSets.push({ studentId, role, sessionVersion });
      return "fake-jwt-token";
    },
    signMfaSessionToken: (id: string) => `mfa-token-for-${id}`,
    setMfaSessionCookie: async (token: string) => {
      mfaCookieSets.push(token);
    },
  },
});

const studentDelegate = {
  findUnique: mockFindUnique,
  findFirst: mockFindFirst,
  create: mockCreate,
  update: mockUpdate,
};

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: { student: studentDelegate },
    prisma: { student: studentDelegate },
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: mock.fn(),
      info: mockLoggerInfo,
      warn: mockLoggerWarn,
      error: mockLoggerError,
    },
  },
});

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) => (name === "oauth-state" ? { name, value: STATE } : undefined),
      delete: () => undefined,
      set: () => undefined,
    }),
  },
});

mock.module("google-auth-library", {
  namedExports: {
    OAuth2Client: class {
      constructor(_clientId?: string) {}
      async verifyIdToken() {
        return { getPayload: () => tokenPayload };
      }
    },
  },
});

const originalFetch = globalThis.fetch;
const mockFetch = mock.fn(
  async () =>
    new Response(JSON.stringify({ access_token: "at", id_token: "idt", token_type: "Bearer" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
) as any;

let route: Awaited<typeof import("../route")>;

before(async () => {
  // Read at module load, so they must exist before the route is imported.
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  delete process.env.GOOGLE_REDIRECT_URI;
  globalThis.fetch = mockFetch;
  route = await import("../route");
});

after(() => {
  globalThis.fetch = originalFetch;
});

// --- fixtures ---------------------------------------------------------------

function verifiedPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: GOOGLE_SUB,
    email: GOOGLE_EMAIL,
    email_verified: true,
    name: "Pat Teacher",
    ...overrides,
  };
}

function student(overrides: Record<string, unknown> = {}) {
  return {
    id: "stu-1",
    studentId: "teacher",
    displayName: "Pat",
    email: "teacher@example.com",
    role: "teacher",
    passwordHash: "scrypt$abc$def",
    authProvider: "password",
    googleId: null as string | null,
    isActive: true,
    mfaEnabled: false,
    sessionVersion: 3,
    ...overrides,
  };
}

/**
 * Seeds the Prisma lookups. `bySub` answers `findUnique({ where: { googleId } })`,
 * `byEmail` answers `findUnique({ where: { email } })`. `findFirst` (the
 * pre-fix email lookup) returns whichever exists so the regression case still
 * passes against the old code.
 */
function seedLookup(opts: { bySub?: ReturnType<typeof student> | null; byEmail?: ReturnType<typeof student> | null }) {
  const bySub = opts.bySub ?? null;
  const byEmail = opts.byEmail ?? null;
  mockFindUnique.mock.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    if (where.googleId !== undefined) return bySub;
    if (where.email !== undefined) return byEmail;
    return null;
  });
  mockFindFirst.mock.mockImplementation(async () => byEmail ?? bySub);
}

function callbackRequest() {
  return mockRequest("/api/auth/google/callback", {
    searchParams: { code: "auth-code", state: STATE },
  });
}

function redirectTarget(res: Response): string {
  const location = res.headers.get("location");
  assert.ok(location, "expected a redirect Location header");
  const url = new URL(location);
  return `${url.pathname}${url.search}`;
}

function auditActions(): string[] {
  return mockLogAuditEvent.mock.calls.map((c: { arguments: [{ action: string }] }) => c.arguments[0].action);
}

function auditEvent(action: string) {
  const call = mockLogAuditEvent.mock.calls.find(
    (c: { arguments: [{ action: string }] }) => c.arguments[0].action === action,
  );
  assert.ok(call, `expected an audit event with action ${action}; saw ${JSON.stringify(auditActions())}`);
  return call.arguments[0] as Record<string, unknown>;
}

function assertNoGoogleIdentityIn(value: unknown, label: string) {
  const text = JSON.stringify(value);
  assert.equal(text.includes("example.com"), false, `${label} must not carry the Google email`);
  assert.equal(text.includes(GOOGLE_SUB), false, `${label} must not carry the Google sub`);
  assert.equal(text.includes(OTHER_GOOGLE_SUB), false, `${label} must not carry a Google sub`);
}

// --- tests ------------------------------------------------------------------

describe("GET /api/auth/google/callback", () => {
  beforeEach(() => {
    cookieSets.length = 0;
    mfaCookieSets.length = 0;
    mockFindUnique.mock.resetCalls();
    mockFindFirst.mock.resetCalls();
    mockCreate.mock.resetCalls();
    mockUpdate.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockLoggerInfo.mock.resetCalls();
    mockLoggerWarn.mock.resetCalls();
    mockLoggerError.mock.resetCalls();
    mockFetch.mock.resetCalls();

    tokenPayload = verifiedPayload();
    seedLookup({});
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockCreate.mock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      student({ id: "stu-new", role: "student", authProvider: "google", passwordHash: null, ...data }),
    );
    mockUpdate.mock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      student({ ...data }),
    );
  });

  // (a) unverified email → refused, no session cookie, no DB write
  it("refuses an unverified Google email: no session, no MFA cookie, no account read or written", async () => {
    tokenPayload = verifiedPayload({ email_verified: false });

    const res = await route.GET(callbackRequest() as never);

    assert.equal(res.status, 307);
    assert.equal(redirectTarget(res), "/?error=oauth_email_unverified");
    assert.equal(cookieSets.length, 0, "no session cookie on refusal");
    assert.equal(mfaCookieSets.length, 0, "no MFA challenge cookie on refusal");
    assert.equal(mockCreate.mock.callCount(), 0, "no account may be created from an unverified email");
    assert.equal(mockUpdate.mock.callCount(), 0, "no account may be linked from an unverified email");
    assert.equal(mockFindUnique.mock.callCount() + mockFindFirst.mock.callCount(), 0, "unverified claims must not reach the database");

    assert.equal(mockLoggerWarn.mock.callCount(), 1, "one warn-level log line for the refusal");
    const [message, context] = mockLoggerWarn.mock.calls[0].arguments as [string, unknown];
    assert.match(message, /unverified email/i);
    assertNoGoogleIdentityIn({ message, context }, "refusal log line");

    const event = auditEvent("auth.google_login_refused_unverified_email");
    assertNoGoogleIdentityIn(event, "refusal audit event");
  });

  it("treats a missing email_verified claim as unverified", async () => {
    const { email_verified: _dropped, ...withoutClaim } = verifiedPayload();
    tokenPayload = withoutClaim;

    const res = await route.GET(callbackRequest() as never);

    assert.equal(redirectTarget(res), "/?error=oauth_email_unverified");
    assert.equal(cookieSets.length, 0);
    assert.equal(mockCreate.mock.callCount() + mockUpdate.mock.callCount(), 0);
  });

  // (b) MFA-enabled account → challenge cookie set, session cookie absent
  it("issues the MFA challenge, not a session, for an MFA-enabled account", async () => {
    seedLookup({ bySub: student({ googleId: GOOGLE_SUB, mfaEnabled: true }) });

    const res = await route.GET(callbackRequest() as never);

    assert.equal(res.status, 307);
    assert.equal(redirectTarget(res), "/?mfa=1");
    assert.deepEqual(mfaCookieSets, ["mfa-token-for-stu-1"], "the same challenge cookie the password route sets");
    assert.equal(cookieSets.length, 0, "no session cookie until TOTP verifies");

    const event = auditEvent("auth.google_login_mfa_required");
    assert.equal(event.actorId, "stu-1");
    assert.equal(event.targetId, "stu-1");

    const infoCall = mockLoggerInfo.mock.calls.find(
      (c: { arguments: [string] }) => /requires mfa/i.test(c.arguments[0]),
    );
    assert.ok(infoCall, "expected an info log line for the MFA requirement");
    const [, context] = infoCall.arguments as [string, Record<string, unknown>];
    assert.equal(context.student, studentLogKey("stu-1"), "log correlates by studentLogKey only");
    assertNoGoogleIdentityIn(infoCall.arguments, "MFA-required log line");
    assert.equal(JSON.stringify(infoCall.arguments).includes("stu-1"), false, "raw student id must not be logged");
  });

  // (c) account with a different bound googleId → refused
  it("refuses when the email's account is already bound to a different Google account", async () => {
    seedLookup({ bySub: null, byEmail: student({ googleId: OTHER_GOOGLE_SUB }) });

    const res = await route.GET(callbackRequest() as never);

    assert.equal(res.status, 307);
    assert.equal(redirectTarget(res), "/?error=oauth_account_mismatch");
    assert.equal(cookieSets.length, 0, "no session for a mismatched Google identity");
    assert.equal(mfaCookieSets.length, 0);
    assert.equal(mockUpdate.mock.callCount(), 0, "the bound googleId must not be overwritten");
    assert.equal(mockCreate.mock.callCount(), 0, "no duplicate account may be created");

    const event = auditEvent("auth.google_login_refused_account_mismatch");
    assert.equal(event.targetId, "stu-1");
    assertNoGoogleIdentityIn(event, "mismatch audit event");
  });

  // (d) first verified link persists sub
  it("links a verified email to an unbound account on first sign-in and persists the Google sub", async () => {
    seedLookup({ bySub: null, byEmail: student({ googleId: null }) });

    const res = await route.GET(callbackRequest() as never);

    assert.equal(mockUpdate.mock.callCount(), 1, "exactly one write to bind the Google sub");
    const [updateArgs] = mockUpdate.mock.calls[0].arguments as [{ where: { id: string; AND?: unknown }; data: Record<string, unknown> }];
    assert.equal(updateArgs.where.id, "stu-1");
    assert.deepEqual(updateArgs.where.AND, [{ googleId: null }], "the link claims the row only while googleId is still null");
    assert.equal(updateArgs.data.googleId, GOOGLE_SUB, "the sub is persisted so later sign-ins match by sub");
    assert.equal("displayName" in updateArgs.data, false, "linking must not rewrite the display name from the Google profile");
    assert.equal(mockCreate.mock.callCount(), 0, "an email match never creates a second account");

    assert.equal(res.status, 307);
    assert.equal(redirectTarget(res), "/chat");
    assert.deepEqual(cookieSets, [{ studentId: "stu-1", role: "teacher", sessionVersion: 3 }]);
    assert.ok(auditActions().includes("auth.google_link"), `expected auth.google_link in ${JSON.stringify(auditActions())}`);
  });

  it("does not link when the account is bound to this sub already: no write, plain sign-in", async () => {
    seedLookup({ bySub: student({ googleId: GOOGLE_SUB }) });

    await route.GET(callbackRequest() as never);

    assert.equal(mockUpdate.mock.callCount(), 0);
    assert.equal(mockCreate.mock.callCount(), 0);
    assert.equal(auditActions().includes("auth.google_link"), false);
  });

  it("does not bind the sub on an MFA-enabled unbound account: challenge only, no write", async () => {
    seedLookup({ bySub: null, byEmail: student({ googleId: null, mfaEnabled: true }) });

    const res = await route.GET(callbackRequest() as never);

    assert.equal(redirectTarget(res), "/?mfa=1");
    assert.deepEqual(mfaCookieSets, ["mfa-token-for-stu-1"]);
    assert.equal(cookieSets.length, 0);
    assert.equal(mockUpdate.mock.callCount(), 0, "the bind waits for a full session (follow-up F67 moves it after TOTP)");
    assert.equal(auditActions().includes("auth.google_link"), false);
  });

  it("treats a lost link race (P2025) as a mismatch: refused, no session", async () => {
    seedLookup({ bySub: null, byEmail: student({ googleId: null }) });
    mockUpdate.mock.mockImplementation(async () => {
      throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
    });

    const res = await route.GET(callbackRequest() as never);

    assert.equal(redirectTarget(res), "/?error=oauth_account_mismatch");
    assert.equal(cookieSets.length, 0);
    assert.equal(mfaCookieSets.length, 0);
    assert.equal(mockLoggerError.mock.callCount(), 0, "a lost race is a refusal, not a server error");
    auditEvent("auth.google_login_refused_account_mismatch");
  });

  // (e) plain non-MFA account → session as before
  it("issues a session as before for a non-MFA account bound to this Google sub", async () => {
    seedLookup({ bySub: student({ googleId: GOOGLE_SUB }) });

    const res = await route.GET(callbackRequest() as never);

    assert.equal(res.status, 307);
    assert.equal(redirectTarget(res), "/chat");
    assert.deepEqual(cookieSets, [{ studentId: "stu-1", role: "teacher", sessionVersion: 3 }]);
    assert.equal(mfaCookieSets.length, 0);
    auditEvent("auth.google_login");
  });

  it("creates a new student bound to the Google sub when nothing matches by sub or email", async () => {
    seedLookup({});

    const res = await route.GET(callbackRequest() as never);

    assert.equal(mockCreate.mock.callCount(), 1);
    const [createArgs] = mockCreate.mock.calls[0].arguments as [{ data: Record<string, unknown> }];
    assert.equal(createArgs.data.googleId, GOOGLE_SUB);
    assert.equal(createArgs.data.authProvider, "google");
    assert.equal(createArgs.data.role, "student");
    assert.equal(createArgs.data.email, "teacher@example.com");
    assert.equal(mockUpdate.mock.callCount(), 0);

    assert.equal(redirectTarget(res), "/chat");
    assert.equal(cookieSets.length, 1);
    assert.equal(cookieSets[0].studentId, "stu-new");
  });

  it("signs in the row a concurrent callback created when create hits the googleId or email unique index", async () => {
    const raced = student({ id: "stu-raced", role: "student", authProvider: "google", passwordHash: null, googleId: GOOGLE_SUB });
    let subLookups = 0;
    mockFindUnique.mock.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.googleId !== undefined) {
        subLookups += 1;
        // First lookup misses; by the second, the racing insert has landed.
        return subLookups === 1 ? null : raced;
      }
      return null;
    });
    mockCreate.mock.mockImplementation(async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["googleId"] } });
    });

    const res = await route.GET(callbackRequest() as never);

    assert.equal(mockCreate.mock.callCount(), 1, "a googleId or email collision must not be retried as a studentId collision");
    assert.equal(redirectTarget(res), "/chat");
    assert.deepEqual(cookieSets, [{ studentId: "stu-raced", role: "student", sessionVersion: 3 }]);
    assert.equal(mockLoggerError.mock.callCount(), 0, "the race is not an error");
    auditEvent("auth.google_login");
  });

  it("retries with a suffixed studentId only when the studentId unique index is the one violated", async () => {
    let attempts = 0;
    mockCreate.mock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["studentId"] } });
      }
      return student({ id: "stu-new", role: "student", authProvider: "google", passwordHash: null, ...data });
    });

    const res = await route.GET(callbackRequest() as never);

    assert.equal(mockCreate.mock.callCount(), 2);
    const [first, second] = mockCreate.mock.calls.map(
      (c: { arguments: [{ data: { studentId: string } }] }) => c.arguments[0].data.studentId,
    );
    assert.equal(first, "teacher");
    assert.match(second, /^teacher\d{4}$/);
    assert.equal(redirectTarget(res), "/chat");
    assert.equal(cookieSets.length, 1);
  });

  it("still refuses a deactivated account before any cookie is set", async () => {
    seedLookup({ bySub: student({ googleId: GOOGLE_SUB, isActive: false, mfaEnabled: true }) });

    const res = await route.GET(callbackRequest() as never);

    assert.equal(redirectTarget(res), "/?error=account_deactivated");
    assert.equal(cookieSets.length, 0);
    assert.equal(mfaCookieSets.length, 0, "a deactivated account gets no MFA challenge either");
  });

  it("does not link a deactivated unbound account: refused before any write", async () => {
    seedLookup({ bySub: null, byEmail: student({ googleId: null, isActive: false }) });

    const res = await route.GET(callbackRequest() as never);

    assert.equal(redirectTarget(res), "/?error=account_deactivated");
    assert.equal(mockUpdate.mock.callCount(), 0);
    assert.equal(mockCreate.mock.callCount(), 0);
    assert.equal(cookieSets.length + mfaCookieSets.length, 0);
  });
});
