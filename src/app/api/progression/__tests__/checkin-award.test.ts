/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many real signatures; a loose escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// VQ-R-006 — a GET must not mint XP.
//
// GET /api/progression awarded the daily_checkin event (+15 XP, advances the
// streak) unconditionally, and ProgressionProvider is mounted in the student
// layout — so it fired on every page mount and after every goal action. A
// seven-day "streak" of opening the website unlocked an attendance tier that is
// presented as a downloadable Certificate of Attendance, in a workforce program
// where attendance has funding consequences.
//
// The award now belongs to POST /api/mood: a deliberate student act, once a day.
// ---------------------------------------------------------------------------

const mockAwardEvent = mock.fn() as any;
const mockGetRecentEvents = mock.fn() as any;
const mockFetchReadiness = mock.fn() as any;
const mockGetXpProgress = mock.fn() as any;
const mockGetAchievementsWithDefs = mock.fn() as any;
const mockCheckReadinessAchievements = mock.fn() as any;
const mockRecordDailyCheckin = mock.fn() as any;
const mockMoodCreate = mock.fn() as any;
const mockRecordWellbeingConcern = mock.fn() as any;
const mockRateLimit = mock.fn() as any;

let session = mockStudentSession();

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      (handler: (s: typeof session, req: any, ctx: any) => Promise<Response>) =>
      async (req: any, ctx: any) =>
        handler(session, req, ctx),
    rateLimited: (msg: string) => {
      const e = new Error(msg) as Error & { statusCode: number };
      e.statusCode = 429;
      return e;
    },
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
    rlsContextFor: () => ({ userId: session.id, role: "student", studentId: session.id }),
  },
});

mock.module("@/lib/registry/middleware", {
  namedExports: {
    withRegistry:
      (_toolId: string, handler: (s: typeof session, req: any, ctx: any, tool: any) => Promise<Response>) =>
      async (req: any, ctx: any) =>
        handler(session, req, ctx, { id: _toolId, name: "t" }),
  },
});

mock.module("@/lib/progression/engine", {
  namedExports: {
    getXpProgress: mockGetXpProgress,
    getAchievementsWithDefs: mockGetAchievementsWithDefs,
    recordDailyCheckin: mockRecordDailyCheckin,
    checkReadinessAchievements: mockCheckReadinessAchievements,
  },
});

mock.module("@/lib/progression/events", {
  namedExports: {
    awardEvent: mockAwardEvent,
    getRecentEvents: mockGetRecentEvents,
  },
});

mock.module("@/lib/progression/fetch-readiness-data", {
  namedExports: { fetchStudentReadinessData: mockFetchReadiness },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: { moodEntry: { create: mockMoodCreate, findMany: mock.fn(async () => []) } },
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: { rateLimit: mockRateLimit, rateLimitDaily: mock.fn(async () => ({ success: true })) },
});

mock.module("@/lib/sage/crisis-detection", {
  namedExports: { recordWellbeingConcern: mockRecordWellbeingConcern },
});

mock.module("@/lib/schemas", {
  namedExports: {
    parseBody: async (req: any, schema: any) => schema.parse(await req.json()),
  },
});

let progressionRoute: Awaited<typeof import("../route")>;
let moodRoute: Awaited<typeof import("../../mood/route")>;

before(async () => {
  progressionRoute = await import("../route");
  moodRoute = await import("../../mood/route");
});

const STATE = { achievements: [], levelUpHistory: [], level: 1 };

beforeEach(() => {
  for (const m of [
    mockAwardEvent,
    mockGetRecentEvents,
    mockFetchReadiness,
    mockGetXpProgress,
    mockGetAchievementsWithDefs,
    mockCheckReadinessAchievements,
    mockRecordDailyCheckin,
    mockMoodCreate,
    mockRecordWellbeingConcern,
    mockRateLimit,
  ]) {
    m.mock.resetCalls();
  }
  session = mockStudentSession();
  mockAwardEvent.mock.mockImplementation(async () => true);
  mockGetRecentEvents.mock.mockImplementation(async () => []);
  mockFetchReadiness.mock.mockImplementation(async () => ({
    state: { ...STATE, achievements: [] },
    readiness: { score: 40, breakdown: {} },
  }));
  mockGetXpProgress.mock.mockImplementation(() => ({ xp: 0 }));
  mockGetAchievementsWithDefs.mock.mockImplementation(() => []);
  mockCheckReadinessAchievements.mock.mockImplementation(() => undefined);
  mockRateLimit.mock.mockImplementation(async () => ({ success: true }));
  mockMoodCreate.mock.mockImplementation(async () => ({
    id: "mood-1",
    score: 7,
    source: "self_checkin",
    extractedAt: new Date(),
  }));
});

function awardedEventTypes(): string[] {
  return mockAwardEvent.mock.calls.map((c: any) => c.arguments[0].eventType);
}

describe("GET /api/progression is XP-neutral (VQ-R-006)", () => {
  it("does not award daily_checkin on a read", async () => {
    const res = await progressionRoute.GET(
      mockRequest("/api/progression") as never,
      { params: Promise.resolve({}) } as never,
    );

    assert.equal(res.status, 200);
    assert.ok(
      !awardedEventTypes().includes("daily_checkin"),
      `a GET must never mint the check-in award; awarded: ${JSON.stringify(awardedEventTypes())}`,
    );
  });

  it("does not advance the attendance streak on a read", async () => {
    await progressionRoute.GET(
      mockRequest("/api/progression") as never,
      { params: Promise.resolve({}) } as never,
    );

    assert.equal(
      mockRecordDailyCheckin.mock.callCount(),
      0,
      "recordDailyCheckin drives the streak that feeds the Certificate of Attendance",
    );
  });

  it("still returns the progression payload", async () => {
    const res = await progressionRoute.GET(
      mockRequest("/api/progression") as never,
      { params: Promise.resolve({}) } as never,
    );
    const body = await res.json();
    assert.equal(body.readinessScore, 40);
    assert.ok("xpProgress" in body);
  });

  it("fetches readiness once, not repeatedly", async () => {
    // The route previously read readiness twice per request (before and after
    // its own write) and the provider calls it on every mount.
    await progressionRoute.GET(
      mockRequest("/api/progression") as never,
      { params: Promise.resolve({}) } as never,
    );

    assert.equal(
      mockFetchReadiness.mock.callCount(),
      1,
      "one read per request now that the handler no longer writes first",
    );
  });
});

describe("POST /api/mood owns the check-in award (VQ-R-006)", () => {
  it("awards daily_checkin for a real check-in", async () => {
    const res = await moodRoute.POST(
      mockRequest("/api/mood", { method: "POST", body: { score: 7 } }) as never,
      { params: Promise.resolve({}) } as never,
    );

    assert.equal(res.status, 200);
    assert.ok(
      awardedEventTypes().includes("daily_checkin"),
      "a deliberate mood check-in is the act that earns the streak",
    );
  });

  it("keys the award on the day, so a second check-in cannot double-count", async () => {
    await moodRoute.POST(
      mockRequest("/api/mood", { method: "POST", body: { score: 7 } }) as never,
      { params: Promise.resolve({}) } as never,
    );

    const call = mockAwardEvent.mock.calls.find(
      (c: any) => c.arguments[0].eventType === "daily_checkin",
    );
    assert.ok(call, "expected a daily_checkin award");
    assert.equal(call.arguments[0].sourceType, "checkin");
    assert.match(
      call.arguments[0].sourceId,
      /^\d{4}-\d{2}-\d{2}$/,
      "sourceId must be the day key so awardEvent's unique constraint dedupes",
    );
  });

  it("still records the mood entry and the low-mood alert", async () => {
    await moodRoute.POST(
      mockRequest("/api/mood", { method: "POST", body: { score: 1 } }) as never,
      { params: Promise.resolve({}) } as never,
    );

    assert.equal(mockMoodCreate.mock.callCount(), 1);
    assert.equal(
      mockRecordWellbeingConcern.mock.callCount(),
      1,
      "the crisis safety net must not regress when adding the award",
    );
  });

  it("does not fail the check-in if the award throws", async () => {
    // The mood entry and its wellbeing alert matter more than the XP.
    mockAwardEvent.mock.mockImplementation(async () => {
      throw new Error("progression write failed");
    });

    const res = await moodRoute.POST(
      mockRequest("/api/mood", { method: "POST", body: { score: 6 } }) as never,
      { params: Promise.resolve({}) } as never,
    );

    assert.equal(res.status, 200, "a progression failure must not lose the mood entry");
    assert.equal(mockMoodCreate.mock.callCount(), 1);
  });
});
