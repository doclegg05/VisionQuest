import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { DEMO_CREDENTIALS_REFUSAL } from "@/lib/demo/copy";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

// Cohort demo mode: the shared demo instructor must not turn MFA on for the
// shared account. `@/lib/api-error` stays REAL, so withTeacherAuth turns the
// guard's ApiError into the 403 a browser would see. Every stub records its name
// in `touched`, which proves the refusal happened before any read or write.

const touched: string[] = [];
const touch = (name: string) => async () => {
  touched.push(name);
  return null;
};

mock.module("@/lib/auth", {
  exports: { getSession: async () => mockTeacherSession({ demoAccount: "instructor" }) },
});

mock.module("@/lib/db", {
  exports: {
    prismaAdmin: {
      student: { findUnique: touch("student.findUnique"), updateMany: touch("student.updateMany") },
    },
    prisma: {},
  },
});

mock.module("@/lib/audit", { exports: { logAuditEvent: touch("logAuditEvent") } });

mock.module("@/lib/rate-limit", {
  exports: {
    rateLimit: async () => {
      touched.push("rateLimit");
      return { success: true, remaining: 4, resetTime: 0, degraded: false };
    },
  },
});

mock.module("@/lib/mfa", {
  exports: {
    verifyTotp: () => {
      touched.push("verifyTotp");
      return { valid: false, counter: null };
    },
    generateBackupCodes: () => [],
    hashBackupCodes: () => [],
  },
});

let route: Awaited<typeof import("../route")>;

before(async () => {
  route = await import("../route");
});

describe("POST /api/auth/mfa/verify as a demo account", () => {
  beforeEach(() => {
    touched.length = 0;
  });

  it("refuses a demo account and writes nothing", async () => {
    const res = await route.POST(
      mockRequest("/api/auth/mfa/verify", { method: "POST", body: { token: "123456" } }) as never,
    );

    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: string }).error, DEMO_CREDENTIALS_REFUSAL);
    assert.deepEqual(touched, []);
  });
});
