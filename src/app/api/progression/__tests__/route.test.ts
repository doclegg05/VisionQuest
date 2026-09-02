/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// GET /api/progression must not mutate (2026-09-01 review F25 / VQ-R-006).
// The daily check-in XP moved to POST /api/progression/checkin, keyed on the
// same idempotent ProgressionEvent tuple
//   (studentId, "daily_checkin", "checkin", <YYYY-MM-DD>)
// so a day can never award twice, including across the deploy boundary where
// the old GET already awarded today's check-in.
// ---------------------------------------------------------------------------

const studentSession = mockStudentSession();

// In-memory stand-in for the ProgressionEvent unique constraint awardEvent
// relies on: same tuple → false (already awarded), new tuple → true.
const ledger = new Set<string>();
const mockAwardEvent = mock.fn(async (params: any) => {
  const key = [params.studentId, params.eventType, params.sourceType, params.sourceId].join("|");
  if (ledger.has(key)) return false;
  ledger.add(key);
  return true;
}) as any;
const mockGetRecentEvents = mock.fn(async () => []) as any;
const mockFetchReadiness = mock.fn() as any;

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      (handler: (session: typeof studentSession, ...args: unknown[]) => Promise<Response>) =>
      async (...args: unknown[]) =>
        handler(studentSession, ...args),
  },
});
mock.module("@/lib/progression/events", {
  namedExports: { awardEvent: mockAwardEvent, getRecentEvents: mockGetRecentEvents },
});
mock.module("@/lib/progression/fetch-readiness-data", {
  namedExports: { fetchStudentReadinessData: mockFetchReadiness },
});

let getRoute: typeof import("../route");
let checkinRoute: typeof import("../checkin/route");
let engine: typeof import("@/lib/progression/engine");

before(async () => {
  engine = await import("@/lib/progression/engine");
  getRoute = await import("../route");
  checkinRoute = await import("../checkin/route");
});

function readinessData() {
  return {
    state: engine.createInitialState(),
    readiness: { score: 0, breakdown: {} },
    orientationProgress: { completed: 0, total: 0 },
    bhagCompleted: false,
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function callsOfType(eventType: string) {
  return mockAwardEvent.mock.calls.filter((c: any) => c.arguments[0].eventType === eventType);
}

function postCheckin() {
  return checkinRoute.POST(mockRequest("/api/progression/checkin", { method: "POST" }), {} as any);
}

function resetAll() {
  ledger.clear();
  mockAwardEvent.mock.resetCalls();
  mockGetRecentEvents.mock.resetCalls();
  mockFetchReadiness.mock.resetCalls();
  mockFetchReadiness.mock.mockImplementation(async () => readinessData());
}

describe("GET /api/progression — read only (F25 / VQ-R-006)", () => {
  beforeEach(resetAll);

  it("awards nothing on page load: no progression event, no XP", async () => {
    const res = await getRoute.GET(mockRequest("/api/progression"), {} as any);

    assert.equal(res.status, 200);
    assert.equal(mockAwardEvent.mock.callCount(), 0, "a GET must not write a progression event");
    const body = await res.json();
    assert.equal(typeof body.xp, "number");
    assert.ok(body.xpProgress, "display payload still carries xpProgress");
    assert.ok(Array.isArray(body.achievementsWithDefs));
    assert.ok(Array.isArray(body.recentEvents));
    assert.equal(typeof body.readinessScore, "number");
  });

  it("loading the page twice on the same day still writes nothing", async () => {
    await getRoute.GET(mockRequest("/api/progression"), {} as any);
    await getRoute.GET(mockRequest("/api/progression"), {} as any);

    assert.equal(mockAwardEvent.mock.callCount(), 0);
    assert.equal(ledger.size, 0);
  });
});

describe("POST /api/progression/checkin — the moved daily award", () => {
  beforeEach(resetAll);

  it("awards the daily check-in once, on the idempotent day key", async () => {
    const res = await postCheckin();

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.awarded, true);
    assert.equal(callsOfType("daily_checkin").length, 1);
    const params = callsOfType("daily_checkin")[0].arguments[0];
    assert.equal(params.studentId, studentSession.id);
    assert.equal(params.sourceType, "checkin");
    assert.equal(params.sourceId, today());
    assert.equal(params.xp, 15);
    // The mutate is the engine's daily check-in step (XP + streak).
    const state = engine.createInitialState();
    params.mutate(state);
    assert.equal(state.dailyCheckinsCount, 1);
    assert.equal(state.xp, 15);
  });

  it("a second check-in the same day does not award twice", async () => {
    const first = await postCheckin();
    const second = await postCheckin();

    assert.equal((await first.json()).data.awarded, true);
    assert.equal((await second.json()).data.awarded, false);
    const calls = callsOfType("daily_checkin");
    assert.equal(calls.length, 2, "both calls try; the ledger key dedupes");
    assert.equal(calls[0].arguments[0].sourceId, calls[1].arguments[0].sourceId, "same day key");
    assert.equal([...ledger].filter((k) => k.includes("|daily_checkin|")).length, 1);
  });

  it("uses the key the old GET used, so a check-in already awarded today is not re-awarded after deploy", async () => {
    ledger.add([studentSession.id, "daily_checkin", "checkin", today()].join("|"));

    const res = await postCheckin();

    assert.equal((await res.json()).data.awarded, false);
  });

  it("records no readiness achievement when the score has not crossed a threshold", async () => {
    await postCheckin();

    assert.equal(callsOfType("readiness_check").length, 0);
  });

  it("records the readiness achievement (moved off GET) when the score crosses a threshold", async () => {
    mockFetchReadiness.mock.mockImplementation(async () => ({
      ...readinessData(),
      readiness: { score: 50, breakdown: {} },
    }));

    const res = await postCheckin();

    const readinessCalls = callsOfType("readiness_check");
    assert.equal(readinessCalls.length, 1);
    assert.equal(readinessCalls[0].arguments[0].xp, 0);
    assert.equal(readinessCalls[0].arguments[0].sourceId, today());
    assert.equal((await res.json()).data.readinessAchievementsAdded, 1);
  });
});
