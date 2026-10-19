import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { DEMO_LIMIT_INSTRUCTOR } from "@/lib/demo/copy";
import { mockRequest } from "@/lib/test-helpers";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const rateLimitCalls: Array<[string, number, number]> = [];
let rateLimitSuccess = true;
const bootstrapCalls: number[] = [];
let bootstrapResult: () => Promise<unknown>;
const findUniqueCalls: unknown[] = [];
let instructorRow: { sessionVersion: number } | null;
const cookieCalls: unknown[][] = [];
// The real audit module runs over this table, so a failed audit write is a
// rejected `auditLog.create`, not a hand-made return value.
const auditRows: Array<Record<string, unknown>> = [];
let auditWriteFails = false;
const errorLogs: unknown[][] = [];

mock.module("@/lib/db", {
  exports: {
    prismaAdmin: {
      student: {
        findUnique: async (args: unknown) => {
          findUniqueCalls.push(args);
          return instructorRow;
        },
      },
      auditLog: {
        create: async (args: { data: Record<string, unknown> }) => {
          if (auditWriteFails) throw new Error("audit table unavailable");
          auditRows.push(args.data);
          return args.data;
        },
      },
    },
    prisma: {},
  },
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

mock.module("@/lib/rate-limit", {
  exports: {
    rateLimit: async (key: string, limit: number, windowMs: number) => {
      rateLimitCalls.push([key, limit, windowMs]);
      return { success: rateLimitSuccess, remaining: 0, resetTime: Date.now() + windowMs, degraded: false };
    },
  },
});

mock.module("@/lib/demo/bootstrap", {
  exports: {
    ensureDemoClassroom: () => {
      bootstrapCalls.push(bootstrapCalls.length + 1);
      return bootstrapResult();
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
  rateLimitCalls.length = 0;
  rateLimitSuccess = true;
  bootstrapCalls.length = 0;
  // The memoized session version is deliberately stale (4) against the row (9).
  bootstrapResult = async () => ({ instructorId: "instr-1", instructorSessionVersion: 4, classId: "class-1" });
  findUniqueCalls.length = 0;
  instructorRow = { sessionVersion: 9 };
  cookieCalls.length = 0;
  auditRows.length = 0;
  auditWriteFails = false;
  errorLogs.length = 0;
  process.env.COHORT_DEMO_MODE = "true";
});

afterEach(() => {
  if (originalSwitch === undefined) delete process.env.COHORT_DEMO_MODE;
  else process.env.COHORT_DEMO_MODE = originalSwitch;
});

function post(headers: Record<string, string> = {}) {
  return mockRequest("/api/demo/instructor", { method: "POST", headers });
}

describe("POST /api/demo/instructor", () => {
  it("404s when the switch is off", async () => {
    for (const value of [undefined, "false", "1"]) {
      if (value === undefined) delete process.env.COHORT_DEMO_MODE;
      else process.env.COHORT_DEMO_MODE = value;

      const response = await route.POST(post() as never);

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "Not found" });
    }
    assert.equal(rateLimitCalls.length, 0);
    assert.equal(bootstrapCalls.length, 0, "nothing is created while the demo is off");
    assert.equal(cookieCalls.length, 0);
    assert.equal(auditRows.length, 0);
  });

  it("sets a demo session cookie and returns the redirect", async () => {
    const response = await route.POST(post({ "x-forwarded-for": "203.0.113.9" }) as never);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { redirectTo: "/teacher" });
    assert.equal(cookieCalls.length, 1);
    assert.equal(cookieCalls[0][0], "instr-1");
    assert.equal(cookieCalls[0][1], "teacher");
    assert.deepEqual(cookieCalls[0][3], { demo: "instructor" });
  });

  it("signs the session with the instructor's current version, not the remembered one", async () => {
    await route.POST(post() as never);

    assert.equal(findUniqueCalls.length, 1);
    assert.deepEqual(findUniqueCalls[0], { where: { id: "instr-1" }, select: { sessionVersion: true } });
    assert.equal(cookieCalls[0][2], 9, "the row's version, so a bump elsewhere is honored");
  });

  it("limits each network to 30 sign-ins in 15 minutes under the demo-instructor key", async () => {
    await route.POST(post({ "x-forwarded-for": "203.0.113.9" }) as never);

    assert.deepEqual(rateLimitCalls, [["demo-instructor:203.0.113.9", 30, FIFTEEN_MINUTES_MS]]);
  });

  it("returns 429 with the limit message before touching the classroom", async () => {
    rateLimitSuccess = false;

    const response = await route.POST(post() as never);

    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: DEMO_LIMIT_INSTRUCTOR });
    assert.equal(bootstrapCalls.length, 0);
    assert.equal(cookieCalls.length, 0);
    assert.equal(auditRows.length, 0);
  });

  it("audits the sign-in", async () => {
    await route.POST(post() as never);

    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].action, "demo.instructor.signin");
    assert.equal(auditRows[0].targetType, "student");
    assert.equal(auditRows[0].targetId, "instr-1");
  });

  it("still signs in when the audit write fails", async () => {
    auditWriteFails = true;

    const response = await route.POST(post() as never);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { redirectTo: "/teacher" });
    assert.equal(cookieCalls.length, 1, "the session cookie is set");
    assert.equal(cookieCalls[0][0], "instr-1");
    assert.deepEqual(cookieCalls[0][3], { demo: "instructor" });
    assert.equal(auditRows.length, 0);
    assert.ok(
      JSON.stringify(errorLogs).includes("audit_write_failed"),
      "the failed audit write is logged so an operator can see it",
    );
  });

  it("turns a bootstrap failure into the generic 500, once, with nothing about the clash in the log", async () => {
    const clash = "The demo instructor login belongs to an account that is not a demo instructor";
    bootstrapResult = async () => {
      throw new Error(clash);
    };

    const response = await route.POST(post() as never);

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Internal server error", code: "INTERNAL_ERROR" });
    assert.equal(bootstrapCalls.length, 1, "no retry");
    assert.equal(cookieCalls.length, 0);
    assert.equal(auditRows.length, 0);
    assert.equal(JSON.stringify(errorLogs).includes(clash), false, "the clash text stays out of the log");
    assert.equal(JSON.stringify(errorLogs).includes("demo-instructor"), false, "the login stays out of the log");
  });

  it("fails with the generic 500 when the instructor row has gone", async () => {
    instructorRow = null;

    const response = await route.POST(post() as never);

    assert.equal(response.status, 500);
    assert.equal(cookieCalls.length, 0);
    assert.equal(auditRows.length, 0);
  });
});
