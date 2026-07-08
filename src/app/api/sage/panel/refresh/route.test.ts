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
  },
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
});
