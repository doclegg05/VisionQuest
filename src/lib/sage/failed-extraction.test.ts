/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockCreate = mock.fn(async () => ({ id: "fx-1" })) as any;
const mockWarn = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: { failedExtraction: { create: mockCreate } },
  },
});
mock.module("@/lib/logger", {
  namedExports: {
    logger: { warn: mockWarn, error: mock.fn(), info: mock.fn(), debug: mock.fn() },
  },
});

let recordFailedExtraction: typeof import("./failed-extraction").recordFailedExtraction;
let serializeGoalExtractionPayload: typeof import("./failed-extraction").serializeGoalExtractionPayload;
let parseGoalExtractionPayload: typeof import("./failed-extraction").parseGoalExtractionPayload;
let MAX_FAILED_EXTRACTION_PAYLOAD_CHARS: number;

before(async () => {
  ({
    recordFailedExtraction,
    serializeGoalExtractionPayload,
    parseGoalExtractionPayload,
    MAX_FAILED_EXTRACTION_PAYLOAD_CHARS,
  } = await import("./failed-extraction"));
});

const baseInput = {
  studentId: "stu-1",
  extractorKey: "goal_extraction",
  payload: "some snapshot",
  error: "boom",
  attempts: 3,
};

describe("recordFailedExtraction", () => {
  beforeEach(() => {
    mockCreate.mock.resetCalls();
    mockWarn.mock.resetCalls();
    mockCreate.mock.mockImplementation(async () => ({ id: "fx-1" }));
  });

  it("persists a dead-letter row with the given fields", async () => {
    await recordFailedExtraction({ ...baseInput, conversationId: "conv-1", sourceMessageId: "msg-1" });

    assert.equal(mockCreate.mock.callCount(), 1);
    const data = mockCreate.mock.calls[0].arguments[0].data;
    assert.equal(data.studentId, "stu-1");
    assert.equal(data.conversationId, "conv-1");
    assert.equal(data.sourceMessageId, "msg-1");
    assert.equal(data.extractorKey, "goal_extraction");
    assert.equal(data.payload, "some snapshot");
    assert.equal(data.error, "boom");
    assert.equal(data.attempts, 3);
  });

  it("NEVER throws when the database write fails — logs a warning instead", async () => {
    mockCreate.mock.mockImplementation(async () => {
      throw new Error("db down");
    });

    await assert.doesNotReject(() => recordFailedExtraction(baseInput));
    assert.equal(mockWarn.mock.callCount(), 1);
    assert.match(String(mockWarn.mock.calls[0].arguments[1].error), /db down/);
  });

  it("caps the persisted payload at the 8000-char limit", async () => {
    await recordFailedExtraction({ ...baseInput, payload: "x".repeat(20000) });

    const data = mockCreate.mock.calls[0].arguments[0].data;
    assert.equal(data.payload.length, MAX_FAILED_EXTRACTION_PAYLOAD_CHARS);
  });

  it("defaults optional ids to null", async () => {
    await recordFailedExtraction(baseInput);

    const data = mockCreate.mock.calls[0].arguments[0].data;
    assert.equal(data.conversationId, null);
    assert.equal(data.sourceMessageId, null);
  });
});

describe("goal-extraction payload codec", () => {
  it("round-trips stage, programType, and messages", () => {
    const messages = [
      { role: "user" as const, content: "I want my GED" },
      { role: "model" as const, content: "Great goal!" },
    ];
    const payload = serializeGoalExtractionPayload(messages, "goal-setting", "adult_ed");
    const parsed = parseGoalExtractionPayload(payload);

    assert.ok(parsed);
    assert.equal(parsed.stage, "goal-setting");
    assert.equal(parsed.programType, "adult_ed");
    assert.deepEqual(parsed.messages, messages);
  });

  it("drops oldest messages to stay under the cap while remaining valid JSON", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `msg-${i} ${"x".repeat(1500)}`,
    }));
    const payload = serializeGoalExtractionPayload(messages, "goal-setting", null);

    assert.ok(payload.length <= MAX_FAILED_EXTRACTION_PAYLOAD_CHARS);
    const parsed = parseGoalExtractionPayload(payload);
    assert.ok(parsed);
    // Newest messages survive; oldest were dropped.
    const last = parsed.messages[parsed.messages.length - 1];
    assert.match(last.content, /^msg-9/);
  });

  it("truncates a single oversized message instead of emitting broken JSON", () => {
    const messages = [{ role: "user" as const, content: "y".repeat(30000) }];
    const payload = serializeGoalExtractionPayload(messages, "goal-setting", null);

    assert.ok(payload.length <= MAX_FAILED_EXTRACTION_PAYLOAD_CHARS);
    const parsed = parseGoalExtractionPayload(payload);
    assert.ok(parsed);
    assert.equal(parsed.messages.length, 1);
  });

  it("returns null for malformed payloads", () => {
    assert.equal(parseGoalExtractionPayload("not json"), null);
    assert.equal(parseGoalExtractionPayload("{}"), null);
    assert.equal(parseGoalExtractionPayload(JSON.stringify({ v: 2, stage: "x", messages: [] })), null);
    assert.equal(
      parseGoalExtractionPayload(JSON.stringify({ v: 1, stage: "x", messages: [{ role: "alien", content: 1 }] })),
      null,
    );
  });
});
