/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

/**
 * update_work_profile — the five-question intake (Match & Connect Task 2.2).
 *
 * The load-bearing assertion here is that the tool writes ONLY the five fields
 * it asks about. StudentWorkProfile also carries homeZip, county,
 * maxCommuteMinutes and shiftLimits, which the student sets on the Settings
 * form; a chat turn must never overwrite or clear those, and must never be
 * able to redirect the write at another student.
 */

const mockWorkProfileUpsert = mock.fn(async (args: any) => ({
  studentId: args.where.studentId,
  availability: args.create.availability ?? args.update.availability ?? {},
  transport: args.update.transport ?? null,
  homeZip: null,
  county: null,
  maxCommuteMinutes: null,
  payFloorHourly: args.update.payFloorHourly ?? null,
  childcareHours: args.update.childcareHours ?? null,
  earliestStart: args.update.earliestStart ?? null,
  shiftLimits: null,
  updatedAt: new Date("2026-09-05T00:00:00.000Z"),
  updatedVia: args.update.updatedVia ?? "student",
})) as any;
const mockRecordOperation = mock.fn(async () => undefined) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentWorkProfile: {
        get upsert() {
          return mockWorkProfileUpsert;
        },
        findUnique: mock.fn(async () => null),
      },
    },
  },
});

mock.module("../operations", {
  namedExports: {
    operationIdFor: (slug: string, clock: Date) => `op-${clock.getTime()}-${slug}`,
    recordOperation: mockRecordOperation,
  },
});

let WRITE_TOOLS: typeof import("./write-tools").WRITE_TOOLS;

before(async () => {
  ({ WRITE_TOOLS } = await import("./write-tools"));
});

function tool() {
  const found = WRITE_TOOLS.find((t) => t.name === "update_work_profile");
  assert.ok(found, "update_work_profile is not registered in WRITE_TOOLS");
  return found!;
}

function studentCtx() {
  return { session: { id: "stu-1", role: "student" }, conversationId: "conv-1" } as any;
}

function fullGrid(value: boolean) {
  const slots = { morning: value, afternoon: value, evening: value, overnight: value };
  return {
    monday: { ...slots },
    tuesday: { ...slots },
    wednesday: { ...slots },
    thursday: { ...slots },
    friday: { ...slots },
    saturday: { ...slots },
    sunday: { ...slots },
  };
}

describe("update_work_profile", () => {
  beforeEach(() => {
    mockWorkProfileUpsert.mock.resetCalls();
    mockRecordOperation.mock.resetCalls();
  });

  it("is a student-only, reversible write with no confirmation card", () => {
    const t = tool();
    assert.deepEqual([...t.requiredRoles], ["student"]);
    assert.equal(t.riskTier, "mutate_reversible");
    assert.equal(t.enabled, true);
  });

  it("declares exactly the five intake questions as its parameters", () => {
    const t = tool();
    assert.deepEqual(Object.keys(t.parameters.properties).sort(), [
      "availability",
      "childcareHours",
      "earliestStart",
      "payFloorHourly",
      "transport",
    ]);
  });

  it("writes only the five fields, at the student's own id, as via=sage", async () => {
    const result = await tool().execute(
      {
        availability: fullGrid(true),
        transport: "bus",
        payFloorHourly: 15,
        earliestStart: "2026-10-01",
        childcareHours: { note: "Kids are at school 8 to 3." },
      },
      studentCtx(),
    );

    assert.equal(result.status, "success");
    assert.equal(mockWorkProfileUpsert.mock.callCount(), 1);

    const args = mockWorkProfileUpsert.mock.calls[0].arguments[0];
    assert.deepEqual(args.where, { studentId: "stu-1" });

    const allowed = new Set([
      "availability",
      "transport",
      "payFloorHourly",
      "earliestStart",
      "childcareHours",
      "updatedVia",
    ]);
    for (const key of Object.keys(args.update)) {
      assert.ok(allowed.has(key), `update wrote "${key}", which is not one of the five questions`);
    }
    // The Settings-form fields must not appear at all — not even as null,
    // which would silently clear an answer the student typed on the form.
    for (const key of ["homeZip", "county", "maxCommuteMinutes", "shiftLimits"]) {
      assert.ok(!(key in args.update), `update touched "${key}"`);
      assert.ok(!(key in args.create), `create touched "${key}"`);
    }
    assert.equal(args.update.updatedVia, "sage");
    assert.equal(args.create.studentId, "stu-1");
  });

  it("writes only the fields the student actually answered", async () => {
    await tool().execute({ payFloorHourly: 16.5 }, studentCtx());

    const args = mockWorkProfileUpsert.mock.calls[0].arguments[0];
    assert.deepEqual(Object.keys(args.update).sort(), ["payFloorHourly", "updatedVia"]);
    // A first partial answer must not assert "no transport", which the
    // matcher would read as a hard block on every job.
    assert.equal("transport" in args.create, false);
  });

  it("refuses a field outside the five questions instead of writing it", async () => {
    const result = await tool().execute(
      { payFloorHourly: 15, homeZip: "25301" },
      studentCtx(),
    );
    assert.equal(result.status, "error");
    assert.equal(mockWorkProfileUpsert.mock.callCount(), 0);
  });

  it("refuses an invalid transport mode and an unparseable start date", async () => {
    const bad = await tool().execute({ transport: "helicopter" }, studentCtx());
    assert.equal(bad.status, "error");
    const worse = await tool().execute({ earliestStart: "next Tuesday" }, studentCtx());
    assert.equal(worse.status, "error");
    assert.equal(mockWorkProfileUpsert.mock.callCount(), 0);
  });

  it("refuses an empty call rather than stamping updatedVia on nothing", async () => {
    const result = await tool().execute({}, studentCtx());
    assert.equal(result.status, "error");
    assert.equal(mockWorkProfileUpsert.mock.callCount(), 0);
  });

  it("ledgers the write against the acting student", async () => {
    await tool().execute({ payFloorHourly: 15 }, studentCtx());
    assert.equal(mockRecordOperation.mock.callCount(), 1);
    const op = mockRecordOperation.mock.calls[0].arguments[0];
    assert.equal(op.toolName, "update_work_profile");
    assert.equal(op.status, "executed");
    assert.equal(op.targetStudentId, "stu-1");
  });
});
