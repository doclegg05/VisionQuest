/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// ---- Mutable "current session" swapped per test, mirroring the
// reassign-class/route.test.ts and sage-operations/route.test.ts convention
// for real-role-gate coverage. ----
let currentSession: Session = mockStudentSession();

const mockRecordWelcomeCompleted = mock.fn() as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    // Faithful to the real withAuth + withErrorHandler contract: an
    // ApiError-shaped throw (has `statusCode`) becomes that status; any
    // OTHER throw (a real ledger-write failure) becomes a generic 500 that
    // never echoes the raw message — the exact behavior W2 depends on.
    withAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: Session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        try {
          return await handler(currentSession, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      },
    forbidden: (message = "Forbidden") => makeHttpError(403, message),
    badRequest: (message: string) => makeHttpError(400, message),
  },
});

mock.module("@/lib/progression/welcome-completion", {
  namedExports: {
    recordWelcomeCompleted: mockRecordWelcomeCompleted,
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

describe("POST /api/welcome/complete", () => {
  beforeEach(() => {
    currentSession = mockStudentSession();
    mockRecordWelcomeCompleted.mock.resetCalls();
    mockRecordWelcomeCompleted.mock.mockImplementation(async () => true);
  });

  it("returns 403 for a staff session (S4 role gate)", async () => {
    currentSession = mockTeacherSession();
    const req = mockRequest("/api/welcome/complete", {
      method: "POST",
      body: { path: "chat" },
    });

    const res = await route.POST(req as never);
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.match(String(body.error), /students/i);
    assert.equal(mockRecordWelcomeCompleted.mock.callCount(), 0);
  });

  it("returns 500 (not the raw error) when the ledger write really fails (W2)", async () => {
    mockRecordWelcomeCompleted.mock.mockImplementation(async () => {
      throw new Error("ledger write hard-failed: connection reset");
    });
    const req = mockRequest("/api/welcome/complete", {
      method: "POST",
      body: { path: "chat" },
    });

    const res = await route.POST(req as never);
    const body = await res.json();

    assert.equal(res.status, 500);
    // Never leak the raw Prisma/DB error to the client.
    assert.doesNotMatch(String(body.error), /connection reset/);
  });

  it("returns 200 success on an idempotent repeat (recordWelcomeCompleted resolves false)", async () => {
    mockRecordWelcomeCompleted.mock.mockImplementation(async () => false);
    const req = mockRequest("/api/welcome/complete", {
      method: "POST",
      body: { path: "orientation" },
    });

    const res = await route.POST(req as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
  });

  it("returns 200 success on first-time completion", async () => {
    const req = mockRequest("/api/welcome/complete", {
      method: "POST",
      body: { path: "dashboard" },
    });

    const res = await route.POST(req as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(mockRecordWelcomeCompleted.mock.callCount(), 1);
    assert.deepEqual(mockRecordWelcomeCompleted.mock.calls[0].arguments, [
      currentSession.id,
      "dashboard",
    ]);
  });

  it("rejects a path outside the WELCOME_PATHS vocabulary with 400", async () => {
    const req = mockRequest("/api/welcome/complete", {
      method: "POST",
      body: { path: "not-a-real-path" },
    });

    const res = await route.POST(req as never);

    assert.equal(res.status, 400);
    assert.equal(mockRecordWelcomeCompleted.mock.callCount(), 0);
  });
});
