import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { DEMO_NO_SEND_REFUSAL } from "@/lib/demo/copy";
import { mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// Cohort demo mode: a demo account has no phone to confirm, and a demo sends no
// messages, so this route refuses it. `@/lib/api-error` stays REAL, so withAuth
// turns the guard's ApiError into the 403 a browser would see. Every stub
// records its name in `touched`, which proves the refusal happened before the
// guess limiter, the body or the code check.

const touched: string[] = [];

let session: Session = mockStudentSession();

mock.module("@/lib/auth", { exports: { getSession: async () => session } });

mock.module("@/lib/rate-limit", {
  exports: {
    rateLimit: async () => {
      touched.push("rateLimit");
      return { success: true, remaining: 4, resetTime: 0, degraded: false };
    },
  },
});

mock.module("@/lib/nudges/phone-verification", {
  exports: {
    confirmVerificationCode: async () => {
      touched.push("confirmVerificationCode");
      return { ok: true };
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

function confirmRequest() {
  return mockRequest("/api/notifications/preferences/verify-phone/confirm", {
    method: "POST",
    body: { code: "123456" },
  });
}

describe("POST /api/notifications/preferences/verify-phone/confirm and demo accounts", () => {
  beforeEach(() => {
    touched.length = 0;
  });

  it("refuses a demo account and checks no code", async () => {
    const demoSessions: Session[] = [
      mockStudentSession({ demoAccount: "student" }),
      mockTeacherSession({ demoAccount: "instructor" }),
    ];

    for (const demoSession of demoSessions) {
      session = demoSession;
      const res = await route.POST(confirmRequest());

      assert.equal(res.status, 403, `${demoSession.demoAccount} should be refused`);
      assert.equal(((await res.json()) as { error: string }).error, DEMO_NO_SEND_REFUSAL);
      assert.deepEqual(touched, [], `${demoSession.demoAccount} should do no work`);
    }
  });

  it("still checks the code for a real student", async () => {
    session = mockStudentSession();

    const res = await route.POST(confirmRequest());

    assert.equal(res.status, 200);
    assert.deepEqual(touched, ["rateLimit", "confirmVerificationCode"]);
  });
});
