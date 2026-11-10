import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { SAGE_NOTICE_VERSION } from "@/lib/about-sage/notice";
import {
  mockAdminSession,
  mockRequest,
  mockStudentSession,
  mockTeacherSession,
} from "@/lib/test-helpers";

// POST /api/sage-notice records that the signed-in student read the notice.
// `@/lib/api-error` and `@/lib/consent` stay real; only the database and the
// audit writer are stubbed, so the test sees the row the route would write.

let session: Session | null = mockStudentSession();
const created: Array<Record<string, unknown>> = [];

mock.module("@/lib/auth", { exports: { getSession: async () => session } });

mock.module("@/lib/db", {
  exports: {
    prisma: {
      consentRecord: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "c1" };
        },
      },
    },
  },
});

mock.module("@/lib/audit", { exports: { logAuditEvent: async () => undefined } });

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

function post(body: unknown): Request {
  return mockRequest("/api/sage-notice", { method: "POST", body });
}

describe("POST /api/sage-notice", () => {
  beforeEach(() => {
    session = mockStudentSession();
    created.length = 0;
  });

  it("records the current version for the signed-in student", async () => {
    const res = await route.POST(post({ version: SAGE_NOTICE_VERSION }));

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      success: true,
      data: { version: SAGE_NOTICE_VERSION, acknowledged: true },
    });
    assert.deepEqual(created, [
      { studentId: "stu-test-001", scope: `sage_notice:${SAGE_NOTICE_VERSION}`, recordedBy: "stu-test-001" },
    ]);
  });

  it("refuses a body that names another student, and writes nothing", async () => {
    const res = await route.POST(post({ version: SAGE_NOTICE_VERSION, studentId: "stu-other" }));

    assert.equal(res.status, 400);
    assert.equal(created.length, 0);
  });

  it("refuses an older version of the notice, so a stale screen cannot answer for a new one", async () => {
    const res = await route.POST(post({ version: "2020-01-01" }));

    assert.equal(res.status, 400);
    assert.equal(created.length, 0);
  });

  it("refuses a signed-out visitor", async () => {
    session = null;
    const res = await route.POST(post({ version: SAGE_NOTICE_VERSION }));

    assert.equal(res.status, 401);
    assert.equal(created.length, 0);
  });

  for (const [label, staff] of [
    ["teacher", mockTeacherSession()],
    ["admin", mockAdminSession()],
    ["coordinator", mockTeacherSession({ role: "coordinator" })],
  ] as const) {
    it(`refuses a ${label}, who is never asked`, async () => {
      session = staff;
      const res = await route.POST(post({ version: SAGE_NOTICE_VERSION }));

      assert.equal(res.status, 403);
      assert.equal(created.length, 0);
    });
  }
});
