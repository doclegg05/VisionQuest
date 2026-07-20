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
    rateLimited: (message: string) => makeHttpError(429, message),
  },
});

const rateLimitMock = mock.fn(async () => ({
  success: true,
  remaining: 59,
  resetTime: Date.now() + 3600_000,
}));
mock.module("@/lib/rate-limit", {
  namedExports: { rateLimit: rateLimitMock },
});

const agentLoopEnabledMock = mock.fn(() => true);
mock.module("@/lib/sage/agent/flags", {
  namedExports: { isAgentLoopEnabled: agentLoopEnabledMock },
});

const commandsMock = mock.fn((_role: string) => [
  { command: "/goal", description: "Propose a goal" },
]);
mock.module("@/lib/sage/agent/tools", {
  namedExports: { getSlashCommandsForRole: commandsMock },
});

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});

describe("GET /api/chat/slash-commands", () => {
  beforeEach(() => {
    activeSession = mockStudentSession({ id: "student-a", studentId: "student-a" });
    agentLoopEnabledMock.mock.mockImplementation(() => true);
    rateLimitMock.mock.resetCalls();
    rateLimitMock.mock.mockImplementation(async () => ({
      success: true,
      remaining: 59,
      resetTime: Date.now() + 3600_000,
    }));
    commandsMock.mock.resetCalls();
  });

  it("returns the role-filtered command palette when the agent loop is on", async () => {
    const res = await route.GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as { commands: unknown[]; agentEnabled: boolean };
    assert.equal(body.agentEnabled, true);
    assert.equal(body.commands.length, 1);
    assert.equal(commandsMock.mock.calls[0].arguments[0], "student");
  });

  it("returns an empty palette when the agent loop is off", async () => {
    agentLoopEnabledMock.mock.mockImplementation(() => false);
    const res = await route.GET();
    const body = (await res.json()) as { commands: unknown[]; agentEnabled: boolean };
    assert.equal(body.agentEnabled, false);
    assert.equal(body.commands.length, 0);
  });

  it("returns 429 without building the palette when the rate limiter rejects", async () => {
    rateLimitMock.mock.mockImplementation(async () => ({
      success: false,
      remaining: 0,
      resetTime: Date.now() + 3600_000,
    }));
    const res = await route.GET();
    assert.equal(res.status, 429);
    assert.equal(commandsMock.mock.callCount(), 0);
  });

  it("rate limits per user with an hourly window", async () => {
    activeSession = mockTeacherSession({ id: "teacher-1" });
    await route.GET();
    assert.equal(rateLimitMock.mock.callCount(), 1);
    const [key, limit, windowMs] = rateLimitMock.mock.calls[0].arguments as unknown as [
      string,
      number,
      number,
    ];
    assert.equal(key, "chat-slash-commands:teacher-1");
    assert.equal(limit, 60);
    assert.equal(windowMs, 60 * 60 * 1000);
  });
});
