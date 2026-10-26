import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { DEMO_LIMIT_HOURLY } from "@/lib/demo/copy";
import { mockRequest } from "@/lib/test-helpers";

// The route is a thin shell: switch, client address, createDemoStudent, cookie.
// Everything about limits and rows is covered in src/lib/demo/create-student.test.ts.

type CreateResult = Awaited<ReturnType<typeof import("@/lib/demo/create-student").createDemoStudent>>;

const createCalls: Array<[string, ...unknown[]]> = [];
let createResult: () => Promise<CreateResult>;
const cookieCalls: unknown[][] = [];

mock.module("@/lib/db", {
  exports: { prismaAdmin: {}, prisma: {} },
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

mock.module("@/lib/demo/create-student", {
  exports: {
    createDemoStudent: (...args: [string, ...unknown[]]) => {
      createCalls.push(args);
      return createResult();
    },
  },
});

mock.module("@/lib/logger", {
  exports: {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    requestId: () => "test-request-id",
  },
});

let route: Awaited<typeof import("./route")>;
const originalSwitch = process.env.COHORT_DEMO_MODE;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  createCalls.length = 0;
  cookieCalls.length = 0;
  createResult = async () => ({
    kind: "created",
    student: { id: "stu-1", studentId: "demo-0123456789ab", displayName: "Jordan Rivera 5", sessionVersion: 3 },
  });
  process.env.COHORT_DEMO_MODE = "true";
});

afterEach(() => {
  if (originalSwitch === undefined) delete process.env.COHORT_DEMO_MODE;
  else process.env.COHORT_DEMO_MODE = originalSwitch;
});

function post(headers: Record<string, string> = {}) {
  return mockRequest("/api/demo/student", { method: "POST", headers });
}

describe("POST /api/demo/student", () => {
  it("404s when the switch is off", async () => {
    for (const value of [undefined, "false", "1"]) {
      if (value === undefined) delete process.env.COHORT_DEMO_MODE;
      else process.env.COHORT_DEMO_MODE = value;

      const response = await route.POST(post() as never);

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "Not found" });
    }
    assert.equal(createCalls.length, 0, "no student is made while the demo is off");
    assert.equal(cookieCalls.length, 0);
  });

  it("sets a demo session cookie and returns the redirect", async () => {
    const response = await route.POST(post({ "x-forwarded-for": "203.0.113.9" }) as never);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      redirectTo: "/dashboard",
      student: { displayName: "Jordan Rivera 5" },
    });
    assert.deepEqual(cookieCalls, [["stu-1", "student", 3, { demo: "student" }]]);
    assert.deepEqual(createCalls, [["203.0.113.9"]], "the network key is the client address bucket");
  });

  it("uses the shared unknown bucket when there is no forwarded address", async () => {
    await route.POST(post() as never);

    assert.deepEqual(createCalls, [["unknown"]]);
  });

  it("returns 429 with the limit message and sets no cookie", async () => {
    createResult = async () => ({ kind: "limited", message: DEMO_LIMIT_HOURLY });

    const response = await route.POST(post() as never);

    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: DEMO_LIMIT_HOURLY });
    assert.equal(cookieCalls.length, 0);
  });

  it("answers a failure with the generic 500 and no cookie", async () => {
    createResult = async () => {
      throw new Error("A class holds the demo class code but is not the demo class");
    };

    const response = await route.POST(post() as never);

    assert.equal(response.status, 500);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "Internal server error");
    assert.equal(cookieCalls.length, 0);
  });
});
