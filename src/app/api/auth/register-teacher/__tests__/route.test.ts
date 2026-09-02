/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// register-teacher (staff registration) route — request-level tests
//
// Despite the URL/file name, this endpoint backs *both* teacher and admin
// registration via the `registerStaffSchema` (registrationKey, role, ...).
// It is actively called from `src/app/teacher-register/page.tsx`, so the
// "dead code" assumption flagged in Bundle #9 is incorrect — see the PR
// body for the verification.
//
// Covers Tests review #2 / #7 in the 2026-05-08 remediation pass, plus the
// 2026-09-01 review finding F11 / SEC-05: ADMIN_KEY promotion of an existing
// teacher must change the role only. It must not overwrite the password hash
// or display name, must not issue a session, must not touch MFA state, must
// bump sessionVersion so pre-promotion sessions die, and must be audited as
// the key holder rather than as the promoted account.
// ---------------------------------------------------------------------------

type CookieRecord = { studentId: string; role: string; sessionVersion: number };
const cookieSets: CookieRecord[] = [];

/** Order of the DB update and the session-cache invalidation on the promotion path. */
const callOrder: string[] = [];

const mockFindFirst = mock.fn() as any;
const mockCreate = mock.fn() as any;
const mockUpdate = mock.fn() as any;
const mockRateLimit = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockInvalidateSessionCache = mock.fn() as any;
const mockHashPassword = mock.fn((password: string) => ({
  hash: `scrypt$salt$hashed-${password}`,
  salt: "salt",
})) as any;

mock.module("@/lib/auth", {
  namedExports: {
    hashPassword: mockHashPassword,
    invalidateSessionCache: mockInvalidateSessionCache,
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

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: mockRateLimit,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

let registerRoute: Awaited<typeof import("../route")>;
const ORIGINAL_TEACHER_KEY = process.env.TEACHER_KEY;
const ORIGINAL_ADMIN_KEY = process.env.ADMIN_KEY;

const TEACHER_KEY = "test-teacher-key";
const ADMIN_KEY = "test-admin-key";

const EXISTING_TEACHER = {
  id: "tch-1",
  studentId: "alice",
  email: "alice@example.com",
  role: "teacher",
  sessionVersion: 3,
  displayName: "Alice Teacher",
};

const MFA_FIELDS = ["mfaSecret", "mfaEnabled", "mfaBackupCodes", "mfaVerifiedAt", "mfaLastUsedCounter"];

function staffRequest(body: Record<string, unknown>) {
  return mockRequest("/api/auth/register-teacher", { method: "POST", body });
}

/** An ADMIN_KEY holder targeting Alice's account with their own name + password. */
function promotionRequest(overrides: Record<string, unknown> = {}) {
  return staffRequest({
    registrationKey: ADMIN_KEY,
    role: "admin",
    displayName: "Mallory Attacker",
    email: "alice@example.com",
    password: "attacker-chosen-password-1",
    ...overrides,
  });
}

function stubExistingTeacherPromotion() {
  mockFindFirst.mock.mockImplementation(async () => ({ ...EXISTING_TEACHER }));
  mockUpdate.mock.mockImplementation(async () => {
    callOrder.push("update");
    return {
      ...EXISTING_TEACHER,
      role: "admin",
      sessionVersion: EXISTING_TEACHER.sessionVersion + 1,
    };
  });
}

before(async () => {
  // The route reads both keys at module-import time, so set them before the
  // import.
  process.env.TEACHER_KEY = TEACHER_KEY;
  process.env.ADMIN_KEY = ADMIN_KEY;
  registerRoute = await import("../route");
});

after(() => {
  if (ORIGINAL_TEACHER_KEY === undefined) {
    delete process.env.TEACHER_KEY;
  } else {
    process.env.TEACHER_KEY = ORIGINAL_TEACHER_KEY;
  }
  if (ORIGINAL_ADMIN_KEY === undefined) {
    delete process.env.ADMIN_KEY;
  } else {
    process.env.ADMIN_KEY = ORIGINAL_ADMIN_KEY;
  }
});

describe("POST /api/auth/register-teacher (staff registration)", () => {
  beforeEach(() => {
    cookieSets.length = 0;
    callOrder.length = 0;
    mockFindFirst.mock.resetCalls();
    mockCreate.mock.resetCalls();
    mockUpdate.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockInvalidateSessionCache.mock.resetCalls();
    mockHashPassword.mock.resetCalls();

    mockRateLimit.mock.mockImplementation(async () => ({
      success: true,
      remaining: 4,
      resetTime: Date.now() + 60_000,
    }));
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockInvalidateSessionCache.mock.mockImplementation(() => {
      callOrder.push("invalidate");
    });
    mockUpdate.mock.mockImplementation(async () => {
      callOrder.push("update");
      return {
        id: "tch-1",
        studentId: "alice",
        displayName: "Alice",
        role: "teacher",
      };
    });
  });

  describe("ADMIN_KEY promotion of an existing teacher (review F11 / SEC-05)", () => {
    it("changes the role only: password hash and display name untouched, sessionVersion bumped", async () => {
      stubExistingTeacherPromotion();

      const res = await registerRoute.POST(promotionRequest() as never);
      const body = (await res.json()) as { student: Record<string, unknown> };

      assert.equal(res.status, 200);
      assert.equal(mockUpdate.mock.callCount(), 1, "expected exactly one student update");
      assert.equal(mockCreate.mock.callCount(), 0);

      const { where, data } = mockUpdate.mock.calls[0].arguments[0];
      assert.equal(where.id, EXISTING_TEACHER.id);
      assert.deepEqual(
        Object.keys(data).sort(),
        ["role", "sessionVersion"],
        "promotion must write role and sessionVersion and nothing else",
      );
      assert.equal(data.role, "admin");
      assert.deepEqual(data.sessionVersion, { increment: 1 });

      assert.equal(
        mockHashPassword.mock.callCount(),
        0,
        "the supplied password must never be hashed on the promotion path",
      );
      assert.equal(mockInvalidateSessionCache.mock.callCount(), 1);
      assert.equal(mockInvalidateSessionCache.mock.calls[0].arguments[0], EXISTING_TEACHER.id);
      assert.deepEqual(
        callOrder,
        ["update", "invalidate"],
        "the cache entry must be dropped after the row changes, or a stale read can be re-cached",
      );

      assert.deepEqual(
        body.student,
        { id: EXISTING_TEACHER.id, role: "admin" },
        "promotion returns id and role only, never the stored displayName or studentId",
      );
    });

    it("audits the promotion as the admin key, not as the promoted account", async () => {
      stubExistingTeacherPromotion();

      await registerRoute.POST(promotionRequest() as never);

      assert.equal(mockLogAuditEvent.mock.callCount(), 1);
      const event = mockLogAuditEvent.mock.calls[0].arguments[0];
      assert.equal(event.action, "auth.promote_to_admin");
      assert.equal(event.actorId, "admin-key");
      assert.equal(event.actorRole, "admin-key");
      assert.equal(event.targetType, "student");
      assert.equal(event.targetId, EXISTING_TEACHER.id);

      assert.equal(event.metadata.actor, "admin-key");
      assert.equal(event.metadata.previousRole, "teacher");
      assert.equal(event.metadata.newRole, "admin");
      assert.equal("targetLogKey" in event.metadata, false, "the log-key digest is for logs, not storage");

      const identifying = /alice@example\.com|Alice|Mallory/i;
      assert.doesNotMatch(event.summary, identifying, "summary must not carry the email or any name");
      assert.doesNotMatch(
        JSON.stringify(event.metadata),
        identifying,
        "metadata must not carry the email or any name",
      );
    });

    it("issues no session cookie and leaves MFA state untouched", async () => {
      stubExistingTeacherPromotion();

      const res = await registerRoute.POST(promotionRequest() as never);
      const body = (await res.json()) as { sessionIssued: boolean };

      assert.equal(res.status, 200);
      assert.equal(cookieSets.length, 0, "promotion must not sign the caller in as the promoted account");
      assert.equal(body.sessionIssued, false);

      const { data } = mockUpdate.mock.calls[0].arguments[0];
      for (const field of MFA_FIELDS) {
        assert.equal(field in data, false, `promotion must not write ${field}`);
      }
    });

    it("tells the caller the supplied password and display name were ignored", async () => {
      stubExistingTeacherPromotion();

      const res = await registerRoute.POST(promotionRequest() as never);
      const body = (await res.json()) as { promoted: boolean; ignoredFields: string[]; message: string };

      assert.equal(res.status, 200);
      assert.equal(body.promoted, true);
      assert.deepEqual(body.ignoredFields, ["password", "displayName"]);
      assert.match(body.message, /password/i);
      assert.match(body.message, /sign in/i);
    });

    it("does not promote a non-teacher account with the same email (409, no update)", async () => {
      mockFindFirst.mock.mockImplementation(async () => ({ ...EXISTING_TEACHER, role: "student" }));

      const res = await registerRoute.POST(promotionRequest() as never);
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 409);
      assert.match(body.error, /already registered/i);
      assert.equal(mockUpdate.mock.callCount(), 0);
      assert.equal(mockCreate.mock.callCount(), 0);
      assert.equal(cookieSets.length, 0);
      assert.equal(mockLogAuditEvent.mock.callCount(), 0);
    });

    it("TEACHER_KEY cannot promote: existing teacher + role teacher is 409, no update, no cookie", async () => {
      mockFindFirst.mock.mockImplementation(async () => ({ ...EXISTING_TEACHER }));

      const res = await registerRoute.POST(
        promotionRequest({ registrationKey: TEACHER_KEY, role: "teacher" }) as never,
      );
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 409);
      assert.match(body.error, /already registered/i);
      assert.equal(mockUpdate.mock.callCount(), 0);
      assert.equal(cookieSets.length, 0);
    });
  });

  describe("new-staff creation via TEACHER_KEY (unchanged)", () => {
    it("returns 200 + creates account + sets session cookie on valid teacher registration", async () => {
      mockFindFirst.mock.mockImplementation(async () => null);
      mockCreate.mock.mockImplementation(async () => ({
        id: "tch-1",
        studentId: "alice",
        displayName: "Alice Teacher",
        email: "alice@example.com",
        role: "teacher",
        sessionVersion: 1,
      }));

      const req = staffRequest({
        registrationKey: TEACHER_KEY,
        role: "teacher",
        displayName: "Alice Teacher",
        email: "alice@example.com",
        password: "fresh-password-123",
      });

      const res = await registerRoute.POST(req as never);
      const body = (await res.json()) as { student: { id: string; studentId: string; role: string } };

      assert.equal(res.status, 200);
      assert.equal(body.student.id, "tch-1");
      assert.equal(body.student.role, "teacher");
      assert.equal(mockCreate.mock.callCount(), 1, "expected exactly one student create");
      assert.equal(mockUpdate.mock.callCount(), 0);
      assert.equal(mockHashPassword.mock.callCount(), 1, "new accounts hash the supplied password");
      assert.equal(mockHashPassword.mock.calls[0].arguments[0], "fresh-password-123");
      assert.equal(mockCreate.mock.calls[0].arguments[0].data.passwordHash, "scrypt$salt$hashed-fresh-password-123");
      assert.equal(cookieSets.length, 1, "expected session cookie to be set");
      assert.deepEqual(cookieSets[0], { studentId: "tch-1", role: "teacher", sessionVersion: 1 });
      assert.equal(mockLogAuditEvent.mock.callCount(), 1);
      assert.equal(mockLogAuditEvent.mock.calls[0].arguments[0].action, "auth.register_teacher");
      assert.equal(mockLogAuditEvent.mock.calls[0].arguments[0].actorId, "tch-1");
    });

    it("returns 409 when the email is already registered (duplicate email)", async () => {
      // Existing record with the same email but a different role path —
      // simulate "email taken" branch.
      mockFindFirst.mock.mockImplementation(async () => ({
        id: "tch-existing",
        studentId: "alice",
        email: "alice@example.com",
        role: "student",
        sessionVersion: 1,
        displayName: "Alice",
      }));

      const req = staffRequest({
        registrationKey: TEACHER_KEY,
        role: "teacher",
        displayName: "Alice Teacher",
        email: "alice@example.com",
        password: "fresh-password-123",
      });

      const res = await registerRoute.POST(req as never);
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 409);
      assert.match(body.error, /already registered|already taken/i);
      assert.equal(mockCreate.mock.callCount(), 0);
      assert.equal(cookieSets.length, 0);
    });

    it("returns 400 when password is too short (current min: 12 chars)", async () => {
      const req = staffRequest({
        registrationKey: TEACHER_KEY,
        role: "teacher",
        displayName: "Alice Teacher",
        email: "alice@example.com",
        password: "short",
      });

      const res = await registerRoute.POST(req as never);
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /at least 12/i);
      assert.equal(mockFindFirst.mock.callCount(), 0, "schema validation should run before DB read");
      assert.equal(mockCreate.mock.callCount(), 0);
      assert.equal(cookieSets.length, 0);
    });
  });

  describe("registration key checks (unchanged)", () => {
    it("rejects a wrong teacher key with 403 before touching the database", async () => {
      const res = await registerRoute.POST(
        staffRequest({
          registrationKey: "not-the-key",
          role: "teacher",
          displayName: "Alice Teacher",
          email: "alice@example.com",
          password: "fresh-password-123",
        }) as never,
      );
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 403);
      assert.match(body.error, /invalid teacher registration key/i);
      assert.equal(mockFindFirst.mock.callCount(), 0);
      assert.equal(mockCreate.mock.callCount(), 0);
      assert.equal(cookieSets.length, 0);
    });

    it("rejects the teacher key presented for the admin role with 403 (keys are role-bound)", async () => {
      const res = await registerRoute.POST(promotionRequest({ registrationKey: TEACHER_KEY }) as never);
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 403);
      assert.match(body.error, /invalid admin registration key/i);
      assert.equal(mockFindFirst.mock.callCount(), 0);
      assert.equal(mockUpdate.mock.callCount(), 0);
      assert.equal(cookieSets.length, 0);
    });

    it("rejects a missing key with 400 before touching the database", async () => {
      const res = await registerRoute.POST(promotionRequest({ registrationKey: "" }) as never);
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /registration key is required/i);
      assert.equal(mockFindFirst.mock.callCount(), 0);
      assert.equal(mockUpdate.mock.callCount(), 0);
      assert.equal(cookieSets.length, 0);
    });
  });
});
