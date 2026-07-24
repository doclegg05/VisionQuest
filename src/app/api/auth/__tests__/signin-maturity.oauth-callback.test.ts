/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding intentionally loose for route harnesses */
/**
 * Sign-in maturity contract — Google OAuth callback probes.
 *
 * Goal 0 instrument: asserts the mature contract. Failures against today's
 * code are the baseline Goal 1 will turn green. Do not weaken these cases
 * to make the suite pass — freeze them once Goal 0 lands.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

const cookieJar = new Map<string, { value: string; options?: Record<string, unknown> }>();
const sessionCookieSets: { studentId: string; role: string; sessionVersion: number }[] = [];
const studentCreateCalls: Record<string, unknown>[] = [];
const studentUpdateCalls: { where: unknown; data: Record<string, unknown> }[] = [];

let idTokenPayload: Record<string, unknown> = {
  sub: "google-sub-new-user",
  email: "new.user@example.com",
  email_verified: true,
  name: "New User",
};

const mockFindFirst = mock.fn() as any;
const mockCreate = mock.fn() as any;
const mockUpdate = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) => {
        const entry = cookieJar.get(name);
        return entry ? { value: entry.value } : undefined;
      },
      set: (name: string, value: string, options?: Record<string, unknown>) => {
        cookieJar.set(name, { value, options });
      },
      delete: (name: string) => {
        cookieJar.delete(name);
      },
    }),
  },
});

mock.module("@/lib/auth", {
  namedExports: {
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    setSessionCookie: async (studentId: string, role: string, sessionVersion: number) => {
      sessionCookieSets.push({ studentId, role, sessionVersion });
      return "fake-jwt";
    },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      student: {
        findFirst: mockFindFirst,
        create: mockCreate,
        update: mockUpdate,
      },
    },
    prisma: {
      student: {
        findFirst: mockFindFirst,
        create: mockCreate,
        update: mockUpdate,
      },
    },
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
      info: () => undefined,
      error: () => undefined,
      warn: () => undefined,
    },
  },
});

mock.module("google-auth-library", {
  namedExports: {
    OAuth2Client: class {
      async verifyIdToken() {
        return {
          getPayload: () => idTokenPayload,
        };
      }
    },
  },
});

let googleCallbackRoute: Awaited<typeof import("../google/callback/route")>;

function seedValidState(state = "a".repeat(64)) {
  cookieJar.set("oauth-state", { value: state });
  return state;
}

function callbackRequest(params: Record<string, string>) {
  return mockRequest("/api/auth/google/callback", {
    method: "GET",
    searchParams: params,
  });
}

before(async () => {
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";
  process.env.NODE_ENV = "test";
  delete process.env.GOOGLE_ALLOWED_DOMAINS;

  googleCallbackRoute = await import("../google/callback/route");
});

describe("sign-in maturity — OAuth callback", () => {
  beforeEach(() => {
    cookieJar.clear();
    sessionCookieSets.length = 0;
    studentCreateCalls.length = 0;
    studentUpdateCalls.length = 0;
    mockFindFirst.mock.resetCalls();
    mockCreate.mock.resetCalls();
    mockUpdate.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();

    idTokenPayload = {
      sub: "google-sub-new-user",
      email: "new.user@example.com",
      email_verified: true,
      name: "New User",
    };

    delete process.env.GOOGLE_ALLOWED_DOMAINS;

    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockFindFirst.mock.mockImplementation(async () => null);
    mockCreate.mock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      studentCreateCalls.push(data);
      return {
        id: "stu-new",
        studentId: data.studentId,
        displayName: data.displayName,
        email: data.email,
        role: "student",
        isActive: true,
        sessionVersion: 0,
        authProvider: data.authProvider,
        passwordHash: data.passwordHash ?? null,
      };
    });
    mockUpdate.mock.mockImplementation(async (args: { where: unknown; data: Record<string, unknown> }) => {
      studentUpdateCalls.push(args);
      return { id: "stu-existing", role: "student", sessionVersion: 1, isActive: true };
    });

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: "access",
          id_token: "id-token",
          token_type: "Bearer",
          refresh_token: "refresh-token-value",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;
  });

  it("MATURITY: CSRF — state mismatch rejects without creating a session", async () => {
    seedValidState("b".repeat(64));
    const res = await googleCallbackRoute.GET(
      callbackRequest({ code: "auth-code", state: "c".repeat(64) }) as never,
    );
    assert.ok(res.status >= 300 && res.status < 400);
    assert.match(res.headers.get("location") || "", /oauth_state_mismatch/);
    assert.equal(sessionCookieSets.length, 0);
  });

  it("MATURITY: rejects id_tokens with email_verified !== true", async () => {
    const state = seedValidState();
    idTokenPayload = {
      sub: "google-sub-unverified",
      email: "unverified@example.com",
      email_verified: false,
      name: "Unverified",
    };

    const res = await googleCallbackRoute.GET(
      callbackRequest({ code: "auth-code", state }) as never,
    );
    const location = res.headers.get("location") || "";
    assert.ok(res.status >= 300 && res.status < 400);
    assert.ok(
      /oauth_/.test(location) && !/\/chat/.test(location),
      `unverified email must not land on /chat; got ${location}`,
    );
    assert.equal(sessionCookieSets.length, 0, "no session for unverified email");
  });

  it("MATURITY: password-account email match does not auto-login without explicit link", async () => {
    const state = seedValidState();
    idTokenPayload = {
      sub: "google-sub-attacker",
      email: "alice@example.com",
      email_verified: true,
      name: "Alice",
    };
    mockFindFirst.mock.mockImplementation(async () => ({
      id: "stu-password",
      studentId: "alice",
      email: "alice@example.com",
      passwordHash: "scrypt$abc$def",
      authProvider: "password",
      role: "student",
      isActive: true,
      sessionVersion: 2,
      googleSub: null,
    }));

    const res = await googleCallbackRoute.GET(
      callbackRequest({ code: "auth-code", state }) as never,
    );
    const location = res.headers.get("location") || "";
    assert.equal(sessionCookieSets.length, 0, "must not auto-login into a password account");
    assert.ok(
      !/\/chat/.test(location),
      `must not redirect to /chat without linking; got ${location}`,
    );
  });

  it("MATURITY: new Google user create stores googleSub (provider subject)", async () => {
    const state = seedValidState();
    idTokenPayload = {
      sub: "google-sub-new-user",
      email: "new.user@example.com",
      email_verified: true,
      name: "New User",
    };

    const res = await googleCallbackRoute.GET(
      callbackRequest({ code: "auth-code", state }) as never,
    );
    assert.ok(studentCreateCalls.length >= 1, "expected a student create");
    const created = studentCreateCalls[0];
    assert.equal(
      created.googleSub,
      "google-sub-new-user",
      "googleSub must be persisted on create for rebinding",
    );
    assert.equal(created.authProvider, "google");
    assert.equal(created.passwordHash, null);
    assert.ok(res.headers.get("location")?.includes("/chat"));
  });

  it("MATURITY: returning Google user is rebound by googleSub, not email alone", async () => {
    const state = seedValidState();
    idTokenPayload = {
      sub: "google-sub-known",
      email: "known@example.com",
      email_verified: true,
      name: "Known",
    };

    // Email lookup would find nothing / wrong account — maturity requires sub lookup.
    let findArgs: unknown[] = [];
    mockFindFirst.mock.mockImplementation(async (args: unknown) => {
      findArgs.push(args);
      const where = (args as { where?: Record<string, unknown> })?.where || {};
      if (where.googleSub === "google-sub-known") {
        return {
          id: "stu-known",
          studentId: "known",
          email: "known@example.com",
          passwordHash: null,
          authProvider: "google",
          role: "student",
          isActive: true,
          sessionVersion: 3,
          googleSub: "google-sub-known",
        };
      }
      return null;
    });

    await googleCallbackRoute.GET(callbackRequest({ code: "auth-code", state }) as never);

    const queriedBySub = findArgs.some((args) => {
      const where = (args as { where?: Record<string, unknown> })?.where || {};
      return where.googleSub === "google-sub-known";
    });
    assert.ok(queriedBySub, "callback must look up the user by googleSub");
    assert.equal(sessionCookieSets.length, 1);
    assert.equal(sessionCookieSets[0].studentId, "stu-known");
  });

  it("MATURITY: encrypted refresh-token persistence when Google returns refresh_token", async () => {
    const state = seedValidState();
    idTokenPayload = {
      sub: "google-sub-refresh",
      email: "refresh@example.com",
      email_verified: true,
      name: "Refresh",
    };

    await googleCallbackRoute.GET(callbackRequest({ code: "auth-code", state }) as never);

    const persistedOnCreate = studentCreateCalls.some(
      (row) =>
        typeof row.googleRefreshTokenEncrypted === "string" &&
        row.googleRefreshTokenEncrypted.length > 0 &&
        row.googleRefreshTokenEncrypted !== "refresh-token-value",
    );
    const persistedOnUpdate = studentUpdateCalls.some(
      (row) =>
        typeof row.data.googleRefreshTokenEncrypted === "string" &&
        row.data.googleRefreshTokenEncrypted.length > 0 &&
        row.data.googleRefreshTokenEncrypted !== "refresh-token-value",
    );
    assert.ok(
      persistedOnCreate || persistedOnUpdate,
      "refresh_token must be stored encrypted (never plaintext)",
    );
  });

  it("MATURITY: optional Workspace/domain allowlist rejects non-allowed emails when configured", async () => {
    process.env.GOOGLE_ALLOWED_DOMAINS = "spokes.org,visionquest.local";
    const state = seedValidState();
    idTokenPayload = {
      sub: "google-sub-outside",
      email: "outsider@gmail.com",
      email_verified: true,
      name: "Outsider",
    };

    const res = await googleCallbackRoute.GET(
      callbackRequest({ code: "auth-code", state }) as never,
    );
    const location = res.headers.get("location") || "";
    assert.equal(sessionCookieSets.length, 0);
    assert.ok(
      /oauth_/.test(location) && !/\/chat/.test(location),
      `non-allowlisted domain must be rejected; got ${location}`,
    );
  });

  it("MATURITY: happy-path new Google user creates account and lands on /chat", async () => {
    const state = seedValidState();
    // Soften googleSub assertion for happy-path readiness: session + create must succeed.
    // The dedicated googleSub case above tracks binding maturity separately.
    idTokenPayload = {
      sub: "google-sub-happy",
      email: "happy@example.com",
      email_verified: true,
      name: "Happy Path",
    };

    const res = await googleCallbackRoute.GET(
      callbackRequest({ code: "auth-code", state }) as never,
    );
    assert.ok(studentCreateCalls.length >= 1);
    assert.equal(sessionCookieSets.length, 1);
    assert.match(res.headers.get("location") || "", /\/chat/);
  });
});
