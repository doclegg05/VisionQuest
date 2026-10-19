import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { DEMO_NO_SEND_REFUSAL } from "@/lib/demo/copy";
import { mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// Cohort demo mode: VisionQuest sends no messages from a demo, so a demo
// account may not save a phone number or turn texts on. Other preference
// changes, such as email off, stay allowed. `@/lib/api-error` stays REAL, so
// withAuth turns the guard's ApiError into the 403 a browser would see. Every
// stub records its name in `touched`, which proves the refusal happened before
// any read or write.

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
      notificationPreference: {
        findUnique: touch("notificationPreference.findUnique"),
        upsert: touch("notificationPreference.upsert"),
      },
    },
  },
});

mock.module("@/lib/nudges/phone-verification", {
  exports: {
    phoneNumberInUseByAnotherStudent: async () => {
      touched.push("phoneNumberInUseByAnotherStudent");
      return false;
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

function putRequest(body: unknown) {
  return mockRequest("/api/notifications/preferences", { method: "PUT", body });
}

const demoSessions: Session[] = [
  mockStudentSession({ demoAccount: "student" }),
  mockTeacherSession({ demoAccount: "instructor" }),
];

describe("PUT /api/notifications/preferences and demo accounts", () => {
  beforeEach(() => {
    touched.length = 0;
  });

  it("refuses a demo account that tries to save a phone number", async () => {
    for (const demoSession of demoSessions) {
      session = demoSession;
      const res = await route.PUT(putRequest({ sms: { enabled: false, phoneNumber: "+13045550123" } }));

      assert.equal(res.status, 403, `${demoSession.demoAccount} should be refused`);
      assert.equal(((await res.json()) as { error: string }).error, DEMO_NO_SEND_REFUSAL);
      assert.deepEqual(touched, [], `${demoSession.demoAccount} should do no work`);
    }
  });

  it("refuses a demo account that tries to turn texts on", async () => {
    for (const demoSession of demoSessions) {
      session = demoSession;
      const res = await route.PUT(putRequest({ sms: { enabled: true } }));

      assert.equal(res.status, 403, `${demoSession.demoAccount} should be refused`);
      assert.equal(((await res.json()) as { error: string }).error, DEMO_NO_SEND_REFUSAL);
      assert.deepEqual(touched, [], `${demoSession.demoAccount} should do no work`);
    }
  });

  it("still lets a demo account change its email setting", async () => {
    session = mockStudentSession({ demoAccount: "student" });

    const res = await route.PUT(putRequest({ email: { enabled: false } }));

    assert.equal(res.status, 200);
    assert.deepEqual(touched, ["notificationPreference.upsert"]);
  });

  it("still lets a demo account keep texts off", async () => {
    session = mockStudentSession({ demoAccount: "student" });

    const res = await route.PUT(putRequest({ sms: { enabled: false } }));

    assert.equal(res.status, 200);
  });

  it("still saves a phone number for a real student", async () => {
    session = mockStudentSession();

    const res = await route.PUT(putRequest({ sms: { enabled: false, phoneNumber: "+13045550123" } }));

    assert.equal(res.status, 200);
    assert.ok(touched.includes("notificationPreference.upsert"), "the number should be saved");
  });
});
