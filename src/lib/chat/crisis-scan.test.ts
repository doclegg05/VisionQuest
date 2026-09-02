import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// The wrapper's contract, not the detector's: the detector has its own suite
// (src/lib/sage/crisis-detection.test.ts) and the route test drives the real
// one. Here both sides are stubbed so each branch of the wrapper is isolated.
const mockDetectCrisisSignal = mock.fn<
  (text: string) => { matched: boolean; category: string | null; lang: string | null }
>();
const mockRecordWellbeingConcern = mock.fn<(args: unknown) => Promise<void>>();
const mockLoggerError = mock.fn<(msg: string, meta?: Record<string, unknown>) => void>();

mock.module("@/lib/sage/crisis-detection", {
  namedExports: {
    detectCrisisSignal: mockDetectCrisisSignal,
    recordWellbeingConcern: mockRecordWellbeingConcern,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { error: mockLoggerError, warn: mock.fn(), info: mock.fn() },
  },
});

let scan: typeof import("./crisis-scan");

before(async () => {
  scan = await import("./crisis-scan");
});

const STUDENT_ID = "clstudent0000000000000001";
const MESSAGE = "I just want to end it all";

describe("scanStudentMessageForCrisis", () => {
  beforeEach(() => {
    mockDetectCrisisSignal.mock.resetCalls();
    mockRecordWellbeingConcern.mock.resetCalls();
    mockLoggerError.mock.resetCalls();
    mockDetectCrisisSignal.mock.mockImplementation(() => ({
      matched: false,
      category: null,
      lang: null,
    }));
    mockRecordWellbeingConcern.mock.mockImplementation(async () => undefined);
  });

  it("records nothing when the message carries no signal", async () => {
    await scan.scanStudentMessageForCrisis({
      studentId: STUDENT_ID,
      conversationId: null,
      userMessage: MESSAGE,
    });

    assert.equal(mockDetectCrisisSignal.mock.callCount(), 1);
    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 0);
    assert.equal(mockLoggerError.mock.callCount(), 0);
  });

  it("records a message_signal concern carrying the category only", async () => {
    mockDetectCrisisSignal.mock.mockImplementation(() => ({
      matched: true,
      category: "abuse",
      lang: "es",
    }));

    await scan.scanStudentMessageForCrisis({
      studentId: STUDENT_ID,
      conversationId: "conv-1",
      userMessage: MESSAGE,
    });

    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1);
    assert.deepEqual(mockRecordWellbeingConcern.mock.calls[0].arguments[0], {
      studentId: STUDENT_ID,
      conversationId: "conv-1",
      reason: "message_signal",
      category: "abuse",
    });
  });

  it("never throws when the alert sink fails; the log carries the log key and category, not the id or text", async () => {
    mockDetectCrisisSignal.mock.mockImplementation(() => ({
      matched: true,
      category: "self_harm",
      lang: "en",
    }));
    mockRecordWellbeingConcern.mock.mockImplementation(async () => {
      throw new Error("db unavailable");
    });

    await assert.doesNotReject(() =>
      scan.scanStudentMessageForCrisis({
        studentId: STUDENT_ID,
        conversationId: null,
        userMessage: MESSAGE,
      }),
    );

    assert.equal(mockLoggerError.mock.callCount(), 1);
    const [message, meta] = mockLoggerError.mock.calls[0].arguments;
    assert.equal(message, "Crisis scan failed");
    assert.equal(meta?.category, "self_harm");
    assert.match(String(meta?.student), /^stu_[0-9a-f]{12}$/);
    const serialized = JSON.stringify(meta);
    assert.doesNotMatch(serialized, new RegExp(STUDENT_ID));
    assert.doesNotMatch(serialized, /end it all/);
  });

  it("never throws when the detector itself throws", async () => {
    mockDetectCrisisSignal.mock.mockImplementation(() => {
      throw new Error("bad pattern");
    });

    await assert.doesNotReject(() =>
      scan.scanStudentMessageForCrisis({
        studentId: STUDENT_ID,
        conversationId: null,
        userMessage: MESSAGE,
      }),
    );

    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 0);
    assert.equal(mockLoggerError.mock.callCount(), 1);
    assert.equal(mockLoggerError.mock.calls[0].arguments[1]?.category, null);
  });
});
