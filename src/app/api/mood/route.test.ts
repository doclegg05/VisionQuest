import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Request-level tests for /api/mood — the home-rail mood check-in (POST)
// plus the existing mood-history read (GET).
//
// Both handlers are wrapped in `withRegistry("learning.mood", ...)`; we mock
// the registry middleware as a passthrough that hands the test session to
// the inner handler (same pattern as goals/[id]/__tests__/route.test.ts).
// ---------------------------------------------------------------------------

const session = mockStudentSession();

const mockMoodFindMany = mock.fn<(args: unknown) => Promise<unknown[]>>();
const mockMoodCreate = mock.fn<
  (args: { data: Record<string, unknown>; select: unknown }) => Promise<unknown>
>();
const mockRateLimit = mock.fn<
  (key: string, limit: number, windowMs: number) => Promise<{ success: boolean; remaining: number; resetTime: number }>
>();
const mockRecordWellbeingConcern = mock.fn<(args: unknown) => Promise<void>>(async () => {});

function apiError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.name = "ApiError";
  err.statusCode = statusCode;
  return err;
}

function toResponse(err: unknown): Response {
  if (err && typeof err === "object" && "statusCode" in err) {
    const statusCode = Number((err as { statusCode: number }).statusCode);
    const message = err instanceof Error ? err.message : "Request failed";
    return Response.json({ error: message }, { status: statusCode });
  }
  throw err;
}

mock.module("@/lib/api-error", {
  namedExports: {
    rateLimited: (msg = "Too many requests, please try again later") => apiError(429, msg),
    badRequest: (msg: string) => apiError(400, msg),
  },
});

mock.module("@/lib/schemas", {
  namedExports: {
    parseBody: async (
      req: Request,
      schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } },
    ) => {
      const raw = await req.json();
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw apiError(400, "Invalid request body.");
      return parsed.data;
    },
  },
});

mock.module("@/lib/registry/middleware", {
  namedExports: {
    withRegistry:
      (
        _toolId: string,
        handler: (
          sessionArg: typeof session,
          req: Request,
          ctx: { params: Promise<Record<string, string>> },
          tool: unknown,
        ) => Promise<Response>,
      ) =>
      async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
        try {
          return await handler(session, req, ctx, { id: "learning.mood" });
        } catch (err) {
          return toResponse(err);
        }
      },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      moodEntry: {
        findMany: mockMoodFindMany,
        create: mockMoodCreate,
      },
    },
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: mockRateLimit,
  },
});

mock.module("@/lib/sage/crisis-detection", {
  namedExports: {
    recordWellbeingConcern: mockRecordWellbeingConcern,
  },
});

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});

const routeCtx = { params: Promise.resolve({}) };

function postRequest(body: unknown): Request {
  return mockRequest("/api/mood", { method: "POST", body });
}

describe("/api/mood", () => {
  beforeEach(() => {
    mockMoodFindMany.mock.resetCalls();
    mockMoodCreate.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockRecordWellbeingConcern.mock.resetCalls();

    mockRateLimit.mock.mockImplementation(async () => ({
      success: true,
      remaining: 9,
      resetTime: Date.now() + 60_000,
    }));
    mockMoodFindMany.mock.mockImplementation(async () => []);
    mockMoodCreate.mock.mockImplementation(async (args) => ({
      id: "mood-1",
      score: args.data.score,
      source: args.data.source,
      extractedAt: new Date("2026-07-20T12:00:00.000Z"),
    }));
    mockRecordWellbeingConcern.mock.mockImplementation(async () => {});
  });

  describe("POST (self check-in)", () => {
    it("saves a check-in on the shared 1-10 scale with source self_checkin", async () => {
      const res = await route.POST(postRequest({ score: 8 }) as never, routeCtx as never);
      const body = (await res.json()) as { entry: { score: number; source: string } };

      assert.equal(res.status, 200);
      assert.equal(body.entry.score, 8);
      assert.equal(body.entry.source, "self_checkin");

      assert.equal(mockMoodCreate.mock.callCount(), 1);
      const createArgs = mockMoodCreate.mock.calls[0].arguments[0];
      assert.equal(createArgs.data.studentId, session.id);
      assert.equal(createArgs.data.score, 8);
      assert.equal(createArgs.data.source, "self_checkin");
      // A healthy score must not raise a wellbeing concern.
      assert.equal(mockRecordWellbeingConcern.mock.callCount(), 0);
    });

    it("raises the wellbeing safety-net for a very low score", async () => {
      const res = await route.POST(postRequest({ score: 2 }) as never, routeCtx as never);

      assert.equal(res.status, 200);
      assert.equal(mockMoodCreate.mock.callCount(), 1);
      assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1);
      const concernArgs = mockRecordWellbeingConcern.mock.calls[0].arguments[0] as {
        studentId: string;
        conversationId: string | null;
        reason: string;
      };
      assert.equal(concernArgs.studentId, session.id);
      assert.equal(concernArgs.conversationId, null);
      assert.equal(concernArgs.reason, "low_mood");
    });

    it("rejects scores outside the 1-10 scale", async () => {
      for (const score of [0, 11, 5.5, "7", undefined]) {
        const res = await route.POST(postRequest({ score }) as never, routeCtx as never);
        assert.equal(res.status, 400, `score ${String(score)} should be rejected`);
      }
      assert.equal(mockMoodCreate.mock.callCount(), 0);
      assert.equal(mockRecordWellbeingConcern.mock.callCount(), 0);
    });

    it("returns 429 when the hourly check-in limit is hit", async () => {
      mockRateLimit.mock.mockImplementation(async () => ({
        success: false,
        remaining: 0,
        resetTime: Date.now() + 60_000,
      }));

      const res = await route.POST(postRequest({ score: 6 }) as never, routeCtx as never);

      assert.equal(res.status, 429);
      assert.equal(mockMoodCreate.mock.callCount(), 0);
      const rateKey = mockRateLimit.mock.calls[0].arguments[0];
      assert.equal(rateKey, `mood:checkin:${session.id}`);
    });
  });

  describe("GET (mood history)", () => {
    it("returns the student's recent entries", async () => {
      const entries = [
        { id: "mood-1", score: 7, context: null, source: "self_checkin", conversationId: null, extractedAt: new Date() },
      ];
      mockMoodFindMany.mock.mockImplementation(async () => entries);

      const res = await route.GET(mockRequest("/api/mood") as never, routeCtx as never);
      const body = (await res.json()) as { entries: unknown[] };

      assert.equal(res.status, 200);
      assert.equal(body.entries.length, 1);
      const findArgs = mockMoodFindMany.mock.calls[0].arguments[0] as {
        where: { studentId: string };
      };
      assert.equal(findArgs.where.studentId, session.id);
    });

    it("returns 429 when the hourly read limit is hit", async () => {
      mockRateLimit.mock.mockImplementation(async () => ({
        success: false,
        remaining: 0,
        resetTime: Date.now() + 60_000,
      }));

      const res = await route.GET(mockRequest("/api/mood") as never, routeCtx as never);

      assert.equal(res.status, 429);
      assert.equal(mockMoodFindMany.mock.callCount(), 0);
    });
  });
});
