import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// P1-1 guard coverage: the orientation-complete milestone (Onboarded + 75 XP)
// must not fire while REQUIRED checklist items lack a completed progress row.
// Pending-verification claims are stored with completed: false, so they hold
// completion back until an instructor confirms them.

let currentSession: Session = mockStudentSession();

const mockItemFindMany = mock.fn<(args: unknown) => Promise<Array<{ id: string }>>>();
const mockProgressFindMany = mock.fn<(args: unknown) => Promise<Array<{ itemId: string }>>>();
const mockProgressCount = mock.fn<(args: unknown) => Promise<number>>();
const mockAwardEvent = mock.fn<(args: unknown) => Promise<void>>();

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
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
          throw error;
        }
      },
    forbidden: (message = "Forbidden") => makeHttpError(403, message),
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      orientationItem: { findMany: mockItemFindMany },
      orientationProgress: {
        findMany: mockProgressFindMany,
        count: mockProgressCount,
      },
    },
  },
});

mock.module("@/lib/progression/engine", {
  namedExports: {
    recordOrientationComplete: () => undefined,
  },
});

mock.module("@/lib/progression/events", {
  namedExports: {
    awardEvent: mockAwardEvent,
  },
});

mock.module("@/lib/cache", {
  namedExports: {
    invalidatePrefix: () => undefined,
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageStudent: async () => undefined,
  },
});

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

function completeRequest(body: unknown = {}): Request {
  return new Request("http://localhost:3000/api/orientation/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/orientation/complete (required-items guard)", () => {
  beforeEach(() => {
    currentSession = mockStudentSession();
    mockItemFindMany.mock.resetCalls();
    mockProgressFindMany.mock.resetCalls();
    mockProgressCount.mock.resetCalls();
    mockAwardEvent.mock.resetCalls();

    mockItemFindMany.mock.mockImplementation(async () => [
      { id: "seed-orient-1" },
      { id: "seed-orient-2" },
    ]);
    mockProgressFindMany.mock.mockImplementation(async () => [{ itemId: "seed-orient-1" }]);
    mockProgressCount.mock.mockImplementation(async () => 0);
    mockAwardEvent.mock.mockImplementation(async () => undefined);
  });

  it("refuses (409) while required items are incomplete and awards nothing", async () => {
    const res = await route.POST(completeRequest());
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.missingRequired, 1);
    assert.equal(mockAwardEvent.mock.callCount(), 0);
  });

  it("reports how many missing items are pending instructor verification", async () => {
    mockProgressCount.mock.mockImplementation(async () => 1);

    const res = await route.POST(completeRequest());
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.pendingVerification, 1);
    assert.match(body.error, /verifying/i);
    assert.equal(mockAwardEvent.mock.callCount(), 0);
  });

  it("awards the milestone once every required item has a completed row", async () => {
    mockProgressFindMany.mock.mockImplementation(async () => [
      { itemId: "seed-orient-1" },
      { itemId: "seed-orient-2" },
    ]);

    const res = await route.POST(completeRequest());

    assert.equal(res.status, 200);
    assert.equal(mockAwardEvent.mock.callCount(), 1);
    const award = mockAwardEvent.mock.calls[0].arguments[0] as { eventType: string; xp: number };
    assert.equal(award.eventType, "orientation_complete");
    assert.equal(award.xp, 75);
  });
});
