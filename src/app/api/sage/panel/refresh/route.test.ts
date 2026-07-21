import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

let activeSession = mockStudentSession({ id: "student-a", studentId: "student-a" });

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: typeof activeSession, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        try {
          return await handler(activeSession, ...args);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode ?? 500;
          return Response.json({ error: (err as Error).message }, { status });
        }
      },
    notFound: (message: string) => makeHttpError(404, message),
    rateLimited: (message: string) => makeHttpError(429, message),
  },
});

const rateLimitMock = mock.fn(async () => ({
  success: true,
  remaining: 29,
  resetTime: Date.now() + 3600_000,
}));
mock.module("@/lib/rate-limit", {
  namedExports: { rateLimit: rateLimitMock },
});

const autopilotEnabledMock = mock.fn(() => true);
mock.module("@/lib/sage/briefing", {
  namedExports: { isAutopilotEnabled: autopilotEnabledMock },
});

const refreshMock = mock.fn<(studentId: string) => Promise<"queued" | "cooldown">>(
  async () => "queued",
);
mock.module("@/lib/sage/panel-data", {
  namedExports: { requestPanelRefresh: refreshMock },
});

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});

describe("POST /api/sage/panel/refresh", () => {
  beforeEach(() => {
    activeSession = mockStudentSession({ id: "student-a", studentId: "student-a" });
    autopilotEnabledMock.mock.mockImplementation(() => true);
    rateLimitMock.mock.resetCalls();
    rateLimitMock.mock.mockImplementation(async () => ({
      success: true,
      remaining: 29,
      resetTime: Date.now() + 3600_000,
    }));
    refreshMock.mock.resetCalls();
    refreshMock.mock.mockImplementation(async () => "queued");
  });

  it("queues a refresh for the caller only (no studentId parameter surface)", async () => {
    const res = await route.POST();
    const body = (await res.json()) as { data: { status: string } };
    assert.equal(body.data.status, "queued");
    assert.equal(refreshMock.mock.calls[0].arguments[0], "student-a");
  });

  it("reports cooldown", async () => {
    refreshMock.mock.mockImplementation(async () => "cooldown");
    const res = await route.POST();
    const body = (await res.json()) as { data: { status: string } };
    assert.equal(body.data.status, "cooldown");
  });

  it("reports disabled without queueing when autopilot is off", async () => {
    autopilotEnabledMock.mock.mockImplementation(() => false);
    const res = await route.POST();
    const body = (await res.json()) as { data: { status: string } };
    assert.equal(body.data.status, "disabled");
    assert.equal(refreshMock.mock.callCount(), 0);
  });

  it("404s for non-student roles", async () => {
    activeSession = mockTeacherSession({ id: "teacher-1" });
    const res = await route.POST();
    assert.equal(res.status, 404);
    assert.equal(refreshMock.mock.callCount(), 0);
  });

  it("returns 429 without queueing when the rate limiter rejects", async () => {
    rateLimitMock.mock.mockImplementation(async () => ({
      success: false,
      remaining: 0,
      resetTime: Date.now() + 3600_000,
    }));
    const res = await route.POST();
    assert.equal(res.status, 429);
    assert.equal(refreshMock.mock.callCount(), 0);
  });

  it("rate limits per student with an hourly window", async () => {
    await route.POST();
    assert.equal(rateLimitMock.mock.callCount(), 1);
    const [key, limit, windowMs] = rateLimitMock.mock.calls[0].arguments as unknown as [
      string,
      number,
      number,
    ];
    assert.equal(key, "sage-panel-refresh:student-a");
    assert.equal(limit, 30);
    assert.equal(windowMs, 60 * 60 * 1000);
  });
});
