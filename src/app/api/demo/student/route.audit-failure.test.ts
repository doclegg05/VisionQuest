import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

// route.test.ts stubs createDemoStudent, so it cannot see what happens when the
// audit write fails: that write lives inside createDemoStudent. This file runs
// the real createDemoStudent and the real audit module over a fake database
// whose audit table is down, and checks the visitor still gets in.

const cookieCalls: unknown[][] = [];
const errorLogs: unknown[][] = [];
let auditAttempts = 0;

const fakeTables = {
  student: {
    count: async () => 0,
    create: async (args: { data: Record<string, unknown> }) => ({
      id: "stu-1",
      sessionVersion: 0,
      studentId: args.data.studentId,
      displayName: args.data.displayName,
    }),
  },
  studentClassEnrollment: { create: async () => ({}) },
  $executeRaw: async () => 0,
};

mock.module("@/lib/db", {
  exports: {
    prismaAdmin: {
      ...fakeTables,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTables),
      auditLog: {
        create: async () => {
          auditAttempts += 1;
          throw new Error("audit table unavailable");
        },
      },
    },
    prisma: {},
  },
});

mock.module("@/lib/rate-limit", {
  exports: {
    rateLimit: async () => ({ success: true, remaining: 9, resetTime: Date.now() + 3_600_000, degraded: false }),
  },
});

mock.module("@/lib/demo/bootstrap", {
  exports: {
    ensureDemoClassroom: async () => ({ instructorId: "instr-1", instructorSessionVersion: 0, classId: "class-1" }),
  },
});

mock.module("@/lib/cache", {
  exports: { invalidateChatContext: () => {} },
});

mock.module("@/lib/auth", {
  exports: {
    getSession: async () => null,
    setSessionCookie: async (...args: unknown[]) => {
      cookieCalls.push(args);
      return "fake-jwt-token";
    },
  },
});

mock.module("@/lib/logger", {
  exports: {
    logger: {
      debug: () => {},
      info: () => {},
      warn: (...args: unknown[]) => errorLogs.push(args),
      error: (...args: unknown[]) => errorLogs.push(args),
    },
    requestId: () => "test-request-id",
  },
});

let route: Awaited<typeof import("./route")>;
const originalSwitch = process.env.COHORT_DEMO_MODE;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  cookieCalls.length = 0;
  errorLogs.length = 0;
  auditAttempts = 0;
  process.env.COHORT_DEMO_MODE = "true";
});

afterEach(() => {
  if (originalSwitch === undefined) delete process.env.COHORT_DEMO_MODE;
  else process.env.COHORT_DEMO_MODE = originalSwitch;
});

describe("POST /api/demo/student when the audit write fails", () => {
  it("still sets the session cookie and returns the redirect", async () => {
    const response = await route.POST(mockRequest("/api/demo/student", { method: "POST" }) as never);

    assert.equal(response.status, 200);
    const body = (await response.json()) as { redirectTo: string; student: { displayName: string } };
    assert.equal(body.redirectTo, "/dashboard");
    assert.match(body.student.displayName, /^[A-Z][a-z]+ [A-Z][a-z]+ 1$/);

    assert.equal(auditAttempts, 1, "the audit write was tried");
    assert.equal(cookieCalls.length, 1, "the session cookie is set");
    assert.deepEqual(cookieCalls[0], ["stu-1", "student", 0, { demo: "student" }]);
    assert.ok(
      JSON.stringify(errorLogs).includes("audit_write_failed"),
      "the failed audit write is logged so an operator can see it",
    );
  });
});
