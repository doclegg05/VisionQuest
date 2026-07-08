import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const panelFindFirst = mock.fn();
const adminFindUnique = mock.fn();
const adminUpdate = mock.fn(async () => ({}));

mock.module("@/lib/db", {
  namedExports: {
    prisma: { sagePanel: { findFirst: panelFindFirst } },
    prismaAdmin: { sagePanel: { findUnique: adminFindUnique, update: adminUpdate } },
  },
});

mock.module("@/lib/api-error", {
  namedExports: {
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
  },
});

const assertStaffMock = mock.fn(async () => {});
mock.module("@/lib/classroom", {
  namedExports: { assertStaffCanManageStudent: assertStaffMock },
});

const enqueueCooldownMock = mock.fn(async (): Promise<string | null> => "job-1");
const processByIdMock = mock.fn(async () => 1);
mock.module("@/lib/jobs", {
  namedExports: {
    enqueueJobWithCooldown: enqueueCooldownMock,
    processJobById: processByIdMock,
  },
});

let panelData: typeof import("./panel-data");
before(async () => {
  panelData = await import("./panel-data");
});

const READY_ROW = {
  id: "panel-1",
  spec: { version: 1, cards: [{ type: "encouragement", body: "Keep going." }] },
  createdAt: new Date(),
  model: "mock-model",
};

describe("getLatestPanelSpec", () => {
  beforeEach(() => {
    panelFindFirst.mock.resetCalls();
    panelFindFirst.mock.mockImplementation(async () => READY_ROW);
  });

  it("returns a re-validated spec and scopes the query to the student", async () => {
    const panel = await panelData.getLatestPanelSpec("student-a");
    assert.ok(panel);
    assert.equal(panel.spec.cards.length, 1);
    const where = (panelFindFirst.mock.calls[0].arguments[0] as { where: { studentId: string; status: string } }).where;
    assert.equal(where.studentId, "student-a");
    assert.equal(where.status, "ready");
  });

  it("returns null when no fresh ready panel exists", async () => {
    panelFindFirst.mock.mockImplementation(async () => null);
    assert.equal(await panelData.getLatestPanelSpec("student-a"), null);
  });

  it("returns null (fallback) for corrupt stored Json instead of throwing", async () => {
    panelFindFirst.mock.mockImplementation(async () => ({
      ...READY_ROW,
      spec: { version: 999, cards: "corrupted" },
    }));
    assert.equal(await panelData.getLatestPanelSpec("student-a"), null);
  });
});

describe("dismissPanel", () => {
  beforeEach(() => {
    adminFindUnique.mock.resetCalls();
    adminUpdate.mock.resetCalls();
    assertStaffMock.mock.resetCalls();
    adminFindUnique.mock.mockImplementation(async () => ({ id: "panel-1", studentId: "student-a" }));
  });

  const studentA = { id: "student-a", studentId: "student-a", displayName: "", role: "student" };
  const studentB = { id: "student-b", studentId: "student-b", displayName: "", role: "student" };
  const teacher = { id: "teacher-1", studentId: "teacher-1", displayName: "", role: "teacher" };

  it("lets a student dismiss their own panel", async () => {
    assert.equal(await panelData.dismissPanel("panel-1", studentA), true);
    const arg = adminUpdate.mock.calls[0].arguments[0] as { data: { status: string; dismissedBy: string } };
    assert.equal(arg.data.status, "dismissed");
    assert.equal(arg.data.dismissedBy, "student-a");
  });

  it("refuses another student's panel without revealing it exists", async () => {
    assert.equal(await panelData.dismissPanel("panel-1", studentB), false);
    assert.equal(adminUpdate.mock.callCount(), 0);
  });

  it("returns false for a nonexistent panel", async () => {
    adminFindUnique.mock.mockImplementation(async () => null);
    assert.equal(await panelData.dismissPanel("nope", studentA), false);
  });

  it("routes staff through the classroom-management assertion", async () => {
    assert.equal(await panelData.dismissPanel("panel-1", teacher), true);
    assert.equal(assertStaffMock.mock.callCount(), 1);
  });

  it("propagates a failed staff assertion (unmanaged student) without updating", async () => {
    assertStaffMock.mock.mockImplementation(async () => {
      throw new Error("forbidden");
    });
    await assert.rejects(() => panelData.dismissPanel("panel-1", teacher));
    assert.equal(adminUpdate.mock.callCount(), 0);
  });
});

describe("requestPanelRefresh", () => {
  beforeEach(() => {
    enqueueCooldownMock.mock.resetCalls();
    processByIdMock.mock.resetCalls();
    enqueueCooldownMock.mock.mockImplementation(async () => "job-1");
  });

  it("queues a force regeneration and kicks inline processing", async () => {
    const status = await panelData.requestPanelRefresh("student-a");
    assert.equal(status, "queued");
    const arg = enqueueCooldownMock.mock.calls[0].arguments[0] as {
      payload: { force: boolean };
      cooldownHours: number;
    };
    assert.equal(arg.payload.force, true);
    assert.equal(arg.cooldownHours, 6);
  });

  it("reports cooldown when the dedupe window suppresses the job", async () => {
    enqueueCooldownMock.mock.mockImplementation(async () => null);
    assert.equal(await panelData.requestPanelRefresh("student-a"), "cooldown");
    assert.equal(processByIdMock.mock.callCount(), 0);
  });
});
