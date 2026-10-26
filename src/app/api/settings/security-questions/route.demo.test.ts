import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { DEMO_CREDENTIALS_REFUSAL } from "@/lib/demo/copy";
import { mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// Cohort demo mode: recovery questions are a sign-in setting. The proxy does
// not cover a demo student on this route, so the guard here is the only layer.
// `@/lib/api-error` stays REAL, so withAuth turns the guard's ApiError into the
// 403 a browser would see. Every stub records its name in `touched`, which
// proves the refusal happened before any read or write.

const touched: string[] = [];
const touch = (name: string) => async () => {
  touched.push(name);
  return null;
};

let session: Session = mockStudentSession();

mock.module("@/lib/auth", { exports: { getSession: async () => session } });

mock.module("@/lib/db", {
  exports: {
    prisma: {
      student: { findUnique: touch("student.findUnique") },
      $transaction: touch("$transaction"),
    },
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

mock.module("@/lib/security-question-auth", {
  exports: { hashSecurityAnswers: () => [] },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

function saveRequest() {
  return mockRequest("/api/settings/security-questions", {
    method: "POST",
    body: {
      securityQuestions: {
        birth_city: "Cleveland",
        elementary_school: "Lincoln",
        favorite_teacher: "Jones",
      },
    },
  });
}

describe("POST /api/settings/security-questions and demo accounts", () => {
  beforeEach(() => {
    touched.length = 0;
  });

  it("refuses a demo account and writes nothing", async () => {
    const demoSessions: Session[] = [
      mockStudentSession({ demoAccount: "student" }),
      mockTeacherSession({ demoAccount: "instructor" }),
    ];

    for (const demoSession of demoSessions) {
      session = demoSession;
      const res = await route.POST(saveRequest() as never);

      assert.equal(res.status, 403, `${demoSession.demoAccount} should be refused`);
      assert.equal(((await res.json()) as { error: string }).error, DEMO_CREDENTIALS_REFUSAL);
      assert.deepEqual(touched, [], `${demoSession.demoAccount} should do no work`);
    }
  });

  it("still saves the questions for a real student", async () => {
    session = mockStudentSession();

    const res = await route.POST(saveRequest() as never);

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true });
    assert.ok(touched.includes("$transaction"), "the answers should be written");
  });
});
