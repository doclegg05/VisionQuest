/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockRecordFailedExtraction = mock.fn(async () => undefined) as any;

mock.module("./failed-extraction", {
  namedExports: {
    recordFailedExtraction: mockRecordFailedExtraction,
  },
});
mock.module("@/lib/logger", {
  namedExports: {
    logger: { warn: mock.fn(), error: mock.fn(), info: mock.fn(), debug: mock.fn() },
  },
});

let retryWithBackoff: typeof import("./retry").retryWithBackoff;

before(async () => {
  ({ retryWithBackoff } = await import("./retry"));
});

const opts = { label: "Test op", alertKey: "test_exhausted" };

describe("retryWithBackoff", () => {
  beforeEach(() => {
    mockRecordFailedExtraction.mock.resetCalls();
  });

  it("returns the value without retrying on first success", async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls++;
      return "ok";
    }, opts);

    assert.equal(result, "ok");
    assert.equal(calls, 1);
  });

  it("retries transient failures then succeeds", async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls++;
      if (calls < 2) throw new Error("transient");
      return 42;
    }, opts);

    assert.equal(result, 42);
    assert.equal(calls, 2);
  });

  it("throws the last error after exhausting all attempts", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        retryWithBackoff(
          async () => {
            calls++;
            throw new Error("always fails");
          },
          { ...opts, maxAttempts: 2 },
        ),
      /always fails/,
    );

    assert.equal(calls, 2);
  });

  it("dead-letters an exhausted failure when a studentId is provided", async () => {
    await assert.rejects(
      () =>
        retryWithBackoff(
          async () => {
            throw new Error("always fails");
          },
          {
            ...opts,
            maxAttempts: 2,
            studentId: "stu-1",
            conversationId: "conv-1",
            failurePayload: () => "the input snapshot",
          },
        ),
      /always fails/,
    );

    assert.equal(mockRecordFailedExtraction.mock.callCount(), 1);
    const input = mockRecordFailedExtraction.mock.calls[0].arguments[0];
    assert.equal(input.studentId, "stu-1");
    assert.equal(input.conversationId, "conv-1");
    assert.equal(input.extractorKey, "test_exhausted");
    assert.equal(input.payload, "the input snapshot");
    assert.equal(input.attempts, 2);
    assert.match(input.error, /always fails/);
  });

  it("skips dead-lettering when no studentId is in scope", async () => {
    await assert.rejects(
      () =>
        retryWithBackoff(
          async () => {
            throw new Error("always fails");
          },
          { ...opts, maxAttempts: 2 },
        ),
      /always fails/,
    );

    assert.equal(mockRecordFailedExtraction.mock.callCount(), 0);
  });

  it("still rethrows the original error when the payload builder itself throws", async () => {
    await assert.rejects(
      () =>
        retryWithBackoff(
          async () => {
            throw new Error("extractor error");
          },
          {
            ...opts,
            maxAttempts: 2,
            studentId: "stu-1",
            failurePayload: () => {
              throw new Error("payload builder broke");
            },
          },
        ),
      /extractor error/,
    );

    const input = mockRecordFailedExtraction.mock.calls[0].arguments[0];
    assert.match(input.payload, /payload unavailable/);
  });
});
