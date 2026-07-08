import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

const findManyMock = mock.fn();
mock.module("@/lib/db", {
  namedExports: { prismaAdmin: { student: { findMany: findManyMock } } },
});

const enqueueJobMock = mock.fn(async () => "job-1");
mock.module("@/lib/jobs", { namedExports: { enqueueJob: enqueueJobMock } });

const autopilotEnabledMock = mock.fn(() => true);
mock.module("@/lib/sage/briefing", {
  namedExports: {
    isAutopilotEnabled: autopilotEnabledMock,
    utcPanelDate: () => new Date(Date.UTC(2026, 6, 8)),
  },
});

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});

function request(auth?: string): Request {
  return new Request("http://localhost:3000/api/internal/sage/briefing", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

describe("POST /api/internal/sage/briefing", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    findManyMock.mock.resetCalls();
    enqueueJobMock.mock.resetCalls();
    autopilotEnabledMock.mock.mockImplementation(() => true);
    findManyMock.mock.mockImplementation(async () => [{ id: "s1" }, { id: "s2" }]);
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("401s without a bearer token", async () => {
    const res = await route.POST(request());
    assert.equal(res.status, 401);
    assert.equal(enqueueJobMock.mock.callCount(), 0);
  });

  it("401s with the wrong bearer token", async () => {
    const res = await route.POST(request("Bearer wrong-secret"));
    assert.equal(res.status, 401);
  });

  it("401s when CRON_SECRET is unset (never open by misconfiguration)", async () => {
    delete process.env.CRON_SECRET;
    const res = await route.POST(request("Bearer anything"));
    assert.equal(res.status, 401);
  });

  it("reports disabled without touching the DB when autopilot is off", async () => {
    autopilotEnabledMock.mock.mockImplementation(() => false);
    const res = await route.POST(request("Bearer test-cron-secret"));
    const body = (await res.json()) as { success: boolean; data: { disabled: boolean } };
    assert.equal(res.status, 200);
    assert.equal(body.data.disabled, true);
    assert.equal(findManyMock.mock.callCount(), 0);
  });

  it("enqueues one dedupe-keyed job per active student", async () => {
    const res = await route.POST(request("Bearer test-cron-secret"));
    const body = (await res.json()) as { success: boolean; data: { enqueued: number; total: number } };
    assert.equal(body.data.enqueued, 2);
    assert.equal(body.data.total, 2);
    const firstArg = enqueueJobMock.mock.calls[0].arguments[0] as {
      type: string;
      dedupeKey: string;
      payload: { studentId: string };
    };
    assert.equal(firstArg.type, "sage_briefing");
    assert.equal(firstArg.dedupeKey, "sage_briefing:s1:2026-07-08");
  });

  it("caps fan-out at 50 and reports the cap (no silent truncation)", async () => {
    findManyMock.mock.mockImplementation(async () =>
      Array.from({ length: 60 }, (_, i) => ({ id: `s${i}` })),
    );
    const res = await route.POST(request("Bearer test-cron-secret"));
    const body = (await res.json()) as {
      data: { enqueued: number; total: number; capped: boolean };
    };
    assert.equal(body.data.total, 60);
    assert.equal(body.data.enqueued, 50);
    assert.equal(body.data.capped, true);
  });
});
