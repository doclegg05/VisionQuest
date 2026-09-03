/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { getRlsContext, type RlsContext } from "@/lib/rls-context";

// The cron has no session. Every per-student helper below records the RLS
// context it was called under so the test can prove the body ran as that
// student (review F5, 2026-09-01): under vq_app an app-client query with no
// context fails closed, and the route's per-student catch turned that into
// a silent "sent 0/N".
const seen: Record<"arc" | "advance" | "context" | "notify", (RlsContext | undefined)[]> = {
  arc: [],
  advance: [],
  context: [],
  notify: [],
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let arcStartedAt = new Date();

const findManyMock = mock.fn() as any;
mock.module("@/lib/db", {
  namedExports: { prismaAdmin: { student: { findMany: findManyMock } } },
});

const getOrCreateCoachingArcMock = mock.fn() as any;
const advanceArcWeekMock = mock.fn() as any;
mock.module("@/lib/sage/coaching-arcs", {
  namedExports: {
    getOrCreateCoachingArc: getOrCreateCoachingArcMock,
    advanceArcWeek: advanceArcWeekMock,
  },
});

const gatherDailyPromptContextMock = mock.fn() as any;
mock.module("@/lib/sage/daily-prompt-data", {
  namedExports: { gatherDailyPromptContext: gatherDailyPromptContextMock },
});
mock.module("@/lib/sage/daily-prompts", {
  namedExports: { selectDailyPrompt: () => ({ title: "Today", body: "One small step." }) },
});

const sendMultiChannelNotificationMock = mock.fn() as any;
mock.module("@/lib/notifications", {
  namedExports: { sendMultiChannelNotification: sendMultiChannelNotificationMock },
});

const loggerErrorMock = mock.fn() as any;
mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: mock.fn(), warn: mock.fn(), error: loggerErrorMock },
  },
});

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});

function request(auth?: string): Request {
  return new Request("http://localhost:3000/api/internal/coaching/daily", {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  });
}

function studentContext(studentId: string): RlsContext {
  return { userId: studentId, role: "student", studentId };
}

describe("GET /api/internal/coaching/daily", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    for (const key of Object.keys(seen) as (keyof typeof seen)[]) seen[key].length = 0;
    arcStartedAt = new Date();

    findManyMock.mock.resetCalls();
    getOrCreateCoachingArcMock.mock.resetCalls();
    advanceArcWeekMock.mock.resetCalls();
    gatherDailyPromptContextMock.mock.resetCalls();
    sendMultiChannelNotificationMock.mock.resetCalls();
    loggerErrorMock.mock.resetCalls();

    findManyMock.mock.mockImplementation(async () => [{ id: "student-a" }, { id: "student-b" }]);
    getOrCreateCoachingArcMock.mock.mockImplementation(async () => {
      seen.arc.push(getRlsContext());
      return { status: "active", weekNumber: 1, startedAt: arcStartedAt };
    });
    advanceArcWeekMock.mock.mockImplementation(async () => {
      seen.advance.push(getRlsContext());
    });
    gatherDailyPromptContextMock.mock.mockImplementation(async () => {
      seen.context.push(getRlsContext());
      return { displayName: "Sam" };
    });
    sendMultiChannelNotificationMock.mock.mockImplementation(async () => {
      seen.notify.push(getRlsContext());
      return { inApp: true, email: false, sms: false };
    });
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("401s without the bearer secret and touches nothing", async () => {
    const res = await route.GET(request());
    assert.equal(res.status, 401);
    assert.equal(findManyMock.mock.callCount(), 0);
  });

  it("runs each student's arc, prompt context, and notification as that student", async () => {
    const res = await route.GET(request("Bearer test-cron-secret"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { sent: 2, total: 2 });

    const expected = [studentContext("student-a"), studentContext("student-b")];
    assert.deepEqual(seen.arc, expected, "coaching arc read/upsert ran as the student");
    assert.deepEqual(seen.context, expected, "daily prompt context gathered as the student");
    assert.deepEqual(seen.notify, expected, "notification written as the student");
    assert.equal(getRlsContext(), undefined, "no context leaks out of the loop");
  });

  it("advances an elapsed arc week as the student", async () => {
    arcStartedAt = new Date(Date.now() - 8 * ONE_DAY_MS);
    await route.GET(request("Bearer test-cron-secret"));

    assert.equal(advanceArcWeekMock.mock.callCount(), 2);
    assert.deepEqual(seen.advance, [studentContext("student-a"), studentContext("student-b")]);
  });

  it("one student's failure does not stop the run or leak the student id into the log", async () => {
    gatherDailyPromptContextMock.mock.mockImplementation(async () => {
      seen.context.push(getRlsContext());
      if (getRlsContext()?.studentId === "student-a") throw new Error("boom");
      return { displayName: "Sam" };
    });

    const res = await route.GET(request("Bearer test-cron-secret"));
    assert.deepEqual(await res.json(), { sent: 1, total: 2 });
    assert.deepEqual(seen.notify, [studentContext("student-b")]);

    assert.equal(loggerErrorMock.mock.callCount(), 1);
    const payload = JSON.stringify(loggerErrorMock.mock.calls[0].arguments[1]);
    assert.ok(!payload.includes("student-a"), `log payload carries a raw student id: ${payload}`);
  });
});
