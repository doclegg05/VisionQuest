import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { DEMO_NO_SEND_REFUSAL } from "@/lib/demo/copy";
import { mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// Cohort demo mode: this route texts a code to a phone, and a demo sends no
// messages. `@/lib/api-error` stays REAL, so withAuth turns the guard's
// ApiError into the 403 a browser would see. The stub records its call in
// `touched`, which proves the refusal happened before anything was sent.

const touched: string[] = [];

let session: Session = mockStudentSession();

mock.module("@/lib/auth", { exports: { getSession: async () => session } });

mock.module("@/lib/nudges/phone-verification", {
  exports: {
    sendVerificationCode: async () => {
      touched.push("sendVerificationCode");
      return { ok: true };
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

describe("POST /api/notifications/preferences/verify-phone and demo accounts", () => {
  beforeEach(() => {
    touched.length = 0;
  });

  it("refuses a demo account and sends no code", async () => {
    const demoSessions: Session[] = [
      mockStudentSession({ demoAccount: "student" }),
      mockTeacherSession({ demoAccount: "instructor" }),
    ];

    for (const demoSession of demoSessions) {
      session = demoSession;
      const res = await route.POST();

      assert.equal(res.status, 403, `${demoSession.demoAccount} should be refused`);
      assert.equal(((await res.json()) as { error: string }).error, DEMO_NO_SEND_REFUSAL);
      assert.deepEqual(touched, [], `${demoSession.demoAccount} should do no work`);
    }
  });

  it("still sends a code for a real student", async () => {
    session = mockStudentSession();

    const res = await route.POST();

    assert.equal(res.status, 200);
    assert.deepEqual(touched, ["sendVerificationCode"]);
  });
});
