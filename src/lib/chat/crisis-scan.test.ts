import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";

// The wrapper's contract, not the detector's: the detector has its own suite
// (src/lib/sage/crisis-detection.test.ts) and the route test drives the real
// one. Here both sides are stubbed so each branch of the wrapper is isolated.
const mockDetectCrisisSignal = mock.fn<
  (text: string) => { matched: boolean; category: string | null; lang: string | null }
>();
const mockRecordWellbeingConcern = mock.fn<(args: unknown) => Promise<void>>();
const mockRateLimit = mock.fn<
  (
    key: string,
    limit: number,
    windowMs: number,
  ) => Promise<{ success: boolean; remaining: number; resetTime: number; degraded: boolean }>
>();
const mockLoggerError = mock.fn<(msg: string, meta?: Record<string, unknown>) => void>();
const mockLoggerWarn = mock.fn<(msg: string, meta?: Record<string, unknown>) => void>();
const mockLoggerInfo = mock.fn<(msg: string, meta?: Record<string, unknown>) => void>();

mock.module("@/lib/sage/crisis-detection", {
  namedExports: {
    detectCrisisSignal: mockDetectCrisisSignal,
    recordWellbeingConcern: mockRecordWellbeingConcern,
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: mockRateLimit,
    rateLimitDaily: mock.fn(),
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { error: mockLoggerError, warn: mockLoggerWarn, info: mockLoggerInfo },
  },
});

let scan: typeof import("./crisis-scan");

before(async () => {
  scan = await import("./crisis-scan");
});

const STUDENT_ID = "clstudent0000000000000001";
const MESSAGE = "I just want to end it all";
const CRISIS_KEY = `crisis:${STUDENT_ID}`;
const ADMITTED = { success: true, remaining: 2, resetTime: 0, degraded: false };
const REFUSED = { success: false, remaining: 0, resetTime: 0, degraded: false };

function detectorMatches(category: string) {
  mockDetectCrisisSignal.mock.mockImplementation(() => ({ matched: true, category, lang: "en" }));
}

function runScan() {
  return scan.scanStudentMessageForCrisis({ studentId: STUDENT_ID, userMessage: MESSAGE });
}

/** A log payload may carry the one-way log key, never the id or the text. */
function assertNoIdentifiers(meta: unknown) {
  const serialized = JSON.stringify(meta);
  assert.doesNotMatch(serialized, new RegExp(STUDENT_ID));
  assert.doesNotMatch(serialized, /end it all/);
}

describe("scanStudentMessageForCrisis", () => {
  const previousDisableFlag = process.env.VISIONQUEST_DISABLE_RATE_LIMITS;

  beforeEach(() => {
    for (const fn of [
      mockDetectCrisisSignal,
      mockRecordWellbeingConcern,
      mockRateLimit,
      mockLoggerError,
      mockLoggerWarn,
      mockLoggerInfo,
    ]) {
      fn.mock.resetCalls();
    }
    mockDetectCrisisSignal.mock.mockImplementation(() => ({
      matched: false,
      category: null,
      lang: null,
    }));
    mockRecordWellbeingConcern.mock.mockImplementation(async () => undefined);
    mockRateLimit.mock.mockImplementation(async () => ADMITTED);
    delete process.env.VISIONQUEST_DISABLE_RATE_LIMITS;
  });

  after(() => {
    if (previousDisableFlag === undefined) delete process.env.VISIONQUEST_DISABLE_RATE_LIMITS;
    else process.env.VISIONQUEST_DISABLE_RATE_LIMITS = previousDisableFlag;
  });

  it("records nothing and touches no counter when the message carries no signal", async () => {
    await runScan();

    assert.equal(mockDetectCrisisSignal.mock.callCount(), 1);
    assert.equal(mockRateLimit.mock.callCount(), 0);
    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 0);
    assert.equal(mockLoggerError.mock.callCount(), 0);
  });

  it("records a message_signal concern with the category only and a null conversation id", async () => {
    detectorMatches("abuse");

    await runScan();

    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1);
    assert.deepEqual(mockRecordWellbeingConcern.mock.calls[0].arguments[0], {
      studentId: STUDENT_ID,
      conversationId: null,
      reason: "message_signal",
      category: "abuse",
    });
  });

  it("caps recording per student at 3 per 10 minutes through the atomic limiter", async () => {
    detectorMatches("self_harm");
    const counts = new Map<string, number>();
    mockRateLimit.mock.mockImplementation(async (key, limit) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count <= limit ? ADMITTED : REFUSED;
    });

    for (let i = 0; i < 5; i += 1) await runScan();

    assert.equal(mockRateLimit.mock.callCount(), 5);
    for (const call of mockRateLimit.mock.calls) {
      assert.deepEqual(call.arguments, [CRISIS_KEY, 3, 10 * 60_000]);
    }
    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 3);
    assert.equal(mockLoggerInfo.mock.callCount(), 2);
    for (const call of mockLoggerInfo.mock.calls) {
      const [message, meta] = call.arguments;
      assert.equal(message, "Crisis record burst capped");
      assert.equal(meta?.category, "self_harm");
      assert.match(String(meta?.student), /^stu_[0-9a-f]{12}$/);
      assertNoIdentifiers(meta);
    }
    assert.equal(mockLoggerError.mock.callCount(), 0);
  });

  it("fails open and records when the limiter throws", async () => {
    detectorMatches("self_harm");
    mockRateLimit.mock.mockImplementation(async () => {
      throw new Error("counter table unavailable");
    });

    await assert.doesNotReject(runScan);

    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1);
    assert.equal(mockLoggerWarn.mock.callCount(), 1);
    const [message, meta] = mockLoggerWarn.mock.calls[0].arguments;
    assert.equal(message, "Crisis record limiter failed; recording anyway");
    assert.match(String(meta?.student), /^stu_[0-9a-f]{12}$/);
    assertNoIdentifiers(meta);
    assert.equal(mockLoggerError.mock.callCount(), 0);
  });

  it("records when the limiter returns its own degraded fail-open result", async () => {
    detectorMatches("self_harm");
    mockRateLimit.mock.mockImplementation(async () => ({
      success: true,
      remaining: 0,
      resetTime: 0,
      degraded: true,
    }));

    await runScan();

    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1);
  });

  it("skips the counter when VISIONQUEST_DISABLE_RATE_LIMITS=true, as the route does", async () => {
    process.env.VISIONQUEST_DISABLE_RATE_LIMITS = "true";
    detectorMatches("harm_others");

    await runScan();

    assert.equal(mockRateLimit.mock.callCount(), 0);
    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1);
  });

  it("ignores VISIONQUEST_DISABLE_RATE_LIMITS in production and consults the counter (review F19)", async () => {
    // Indexed by a string variable: Next's types mark NODE_ENV itself read-only.
    const nodeEnv: string = "NODE_ENV";
    const previousNodeEnv = process.env[nodeEnv];
    process.env.VISIONQUEST_DISABLE_RATE_LIMITS = "true";
    process.env[nodeEnv] = "production";
    detectorMatches("harm_others");

    try {
      await runScan();
    } finally {
      if (previousNodeEnv === undefined) delete process.env[nodeEnv];
      else process.env[nodeEnv] = previousNodeEnv;
    }

    assert.equal(mockRateLimit.mock.callCount(), 1);
    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1);
  });

  it("never throws when the alert sink fails; the log carries the log key and category, not the id or text", async () => {
    detectorMatches("self_harm");
    mockRecordWellbeingConcern.mock.mockImplementation(async () => {
      throw new Error("db unavailable");
    });

    await assert.doesNotReject(runScan);

    assert.equal(mockLoggerError.mock.callCount(), 1);
    const [message, meta] = mockLoggerError.mock.calls[0].arguments;
    assert.equal(message, "Crisis scan failed");
    assert.equal(meta?.category, "self_harm");
    assert.match(String(meta?.student), /^stu_[0-9a-f]{12}$/);
    assertNoIdentifiers(meta);
  });

  it("never throws when the detector itself throws", async () => {
    mockDetectCrisisSignal.mock.mockImplementation(() => {
      throw new Error("bad pattern");
    });

    await assert.doesNotReject(runScan);

    assert.equal(mockRateLimit.mock.callCount(), 0);
    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 0);
    assert.equal(mockLoggerError.mock.callCount(), 1);
    assert.equal(mockLoggerError.mock.calls[0].arguments[1]?.category, null);
  });
});
