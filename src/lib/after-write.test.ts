import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { studentLogKey } from "@/lib/log-keys";
import { Prisma } from "@prisma/client";

const mockWarn = mock.fn<(message: string, context?: Record<string, unknown>) => void>();
const mockError = mock.fn<(message: string, context?: Record<string, unknown>) => void>();

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: mockWarn,
      error: mockError,
    },
  },
});

let afterWrite: typeof import("./after-write").afterWrite;

before(async () => {
  ({ afterWrite } = await import("./after-write"));
});

const STUDENT_ID = "stu-after-write-001";
const context = {
  surface: "forms/sign",
  effect: "syncStudentAlerts",
  studentId: STUDENT_ID,
};

describe("afterWrite", () => {
  beforeEach(() => {
    mockWarn.mock.resetCalls();
    mockError.mock.resetCalls();
  });

  it("runs the effect and logs nothing when it succeeds", async () => {
    const effect = mock.fn(async () => "done");

    await afterWrite(effect, context);

    assert.equal(effect.mock.callCount(), 1);
    assert.equal(mockWarn.mock.callCount(), 0);
    assert.equal(mockError.mock.callCount(), 0);
  });

  it("resolves when the effect rejects, and logs a warning with the surface and effect", async () => {
    await afterWrite(async () => {
      throw new Error("advising down");
    }, context);

    assert.equal(mockWarn.mock.callCount(), 1);
    const payload = mockWarn.mock.calls[0].arguments[1] ?? {};
    assert.equal(payload.surface, "forms/sign");
    assert.equal(payload.effect, "syncStudentAlerts");
    assert.deepEqual(payload.error, { name: "Error" });
  });

  it("logs a one-way student key, never the raw student id", async () => {
    await afterWrite(async () => {
      throw new Error("advising down");
    }, context);

    const payload = mockWarn.mock.calls[0].arguments[1] ?? {};
    assert.equal(payload.student, studentLogKey(STUDENT_ID));
    const serialized = JSON.stringify(mockWarn.mock.calls[0].arguments);
    assert.ok(!serialized.includes(STUDENT_ID), `log line leaked the student id: ${serialized}`);
  });

  it("logs at error level when the caller asks for it", async () => {
    await afterWrite(async () => {
      throw new Error("audit insert failed");
    }, { ...context, level: "error" });

    assert.equal(mockError.mock.callCount(), 1);
    assert.equal(mockWarn.mock.callCount(), 0);
    assert.equal(mockError.mock.calls[0].arguments[1]?.student, studentLogKey(STUDENT_ID));
  });

  it("treats a synchronous throw inside the effect the same way", async () => {
    await afterWrite(() => {
      throw new Error("sync throw");
    }, context);

    assert.equal(mockWarn.mock.callCount(), 1);
    assert.deepEqual(mockWarn.mock.calls[0].arguments[1]?.error, { name: "Error" });
  });
  it("logs a Prisma failure by name and code, never the alertKey its message quotes", async () => {
    // syncStudentAlerts upserts alerts keyed `evidence_gap:<studentId>:<id>`,
    // and Prisma's message quotes the key.
    await afterWrite(async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        `Unique constraint failed on alertKey: "evidence_gap:${STUDENT_ID}:req-1"`,
        { code: "P2002", clientVersion: "test" },
      );
    }, context);

    assert.equal(mockWarn.mock.callCount(), 1);
    assert.deepEqual(mockWarn.mock.calls[0].arguments[1]?.error, {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
    });
    const serialized = JSON.stringify(mockWarn.mock.calls[0].arguments);
    assert.ok(!serialized.includes(STUDENT_ID), `log line leaked the student id: ${serialized}`);
  });

  it("keeps provider text out too: an SMTP rejection quotes the recipient", async () => {
    await afterWrite(async () => {
      throw new Error("550 5.1.1 <jane.doe@example.com> rejected; callback +15551234567");
    }, context);

    const serialized = JSON.stringify(mockWarn.mock.calls[0].arguments);
    assert.ok(!serialized.includes("jane.doe@example.com"), `email leaked: ${serialized}`);
    assert.ok(!serialized.includes("5551234567"), `phone leaked: ${serialized}`);
    assert.ok(!serialized.includes("rejected"), `message text leaked: ${serialized}`);
  });
});
