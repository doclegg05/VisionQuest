import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { DEMO_CREDENTIALS_REFUSAL } from "@/lib/demo/copy";
import { mockTeacherSession } from "@/lib/test-helpers";

// Cohort demo mode: the shared demo instructor must not add a second factor to
// the shared account. `@/lib/api-error` stays REAL, so withTeacherAuth turns the
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

mock.module("@/lib/mfa", {
  exports: {
    generateMfaSecret: () => {
      touched.push("generateMfaSecret");
      return { secret: "SECRET", encrypted: "enc:SECRET" };
    },
    generateTotpUri: () => "otpauth://totp/VisionQuest",
  },
});

let route: Awaited<typeof import("../route")>;

before(async () => {
  route = await import("../route");
});

describe("POST /api/auth/mfa/setup as a demo account", () => {
  beforeEach(() => {
    touched.length = 0;
  });

  it("refuses a demo account and writes nothing", async () => {
    const res = await route.POST();

    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: string }).error, DEMO_CREDENTIALS_REFUSAL);
    assert.deepEqual(touched, []);
  });
});
