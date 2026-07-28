/**
 * FROZEN CONTRACT TESTS — provider-neutral AI harness hardening.
 *
 * These tests intentionally exercise only synthetic prompts and mocked
 * providers. Do not weaken or rewrite them to fit an implementation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, GenerationOptions } from "./types";
import {
  AiAdmissionController,
  preparePrompt,
  withAiHarness,
  type AiHarnessTelemetry,
} from "./harness";

function mockedProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    name: "mock-provider",
    async generateResponse() {
      return "ok";
    },
    async *streamResponse() {
      yield "ok";
    },
    async generateStructuredResponse() {
      return "{}";
    },
    ...overrides,
  };
}

describe("provider-neutral prompt preparation", () => {
  it("measures the full prompt and trims history against the total input budget", () => {
    const prepared = preparePrompt({
      systemPrompt: "s".repeat(100),
      history: [
        { role: "user", content: "a".repeat(80) },
        { role: "model", content: "b".repeat(80) },
        { role: "user", content: "c".repeat(80) },
      ],
      currentUserMessage: "d".repeat(20),
      maxInputTokens: 60,
    });

    assert.equal(prepared.telemetry.systemTokens, 25);
    assert.ok(prepared.telemetry.estimatedInputTokens <= 60);
    assert.equal(prepared.telemetry.droppedMessages, 2);
    assert.equal(prepared.telemetry.overBudget, false);
    assert.deepEqual(prepared.messages, [
      { role: "user", content: "c".repeat(80) },
      { role: "user", content: "d".repeat(20) },
    ]);
  });

  it("sends the current user turn exactly once when saved history already contains it", () => {
    const currentUserMessage = "Help me plan my next step.";
    const prepared = preparePrompt({
      systemPrompt: "system",
      history: [
        { role: "user", content: "Earlier question" },
        { role: "model", content: "Earlier answer" },
        { role: "user", content: currentUserMessage },
      ],
      currentUserMessage,
      maxInputTokens: 1_000,
    });

    assert.equal(
      prepared.messages.filter(
        (message) =>
          message.role === "user" && message.content === currentUserMessage,
      ).length,
      1,
    );
    assert.equal(prepared.telemetry.duplicateCurrentMessagesRemoved, 1);
  });
});

describe("AI admission and cancellation", () => {
  it("reserves foreground capacity and does not admit a second background call", async () => {
    const controller = new AiAdmissionController({
      maxConcurrent: 2,
      maxBackgroundConcurrent: 1,
      reservedForeground: 1,
    });

    const backgroundOne = await controller.acquire("background");
    let backgroundTwoAdmitted = false;
    const backgroundTwoPromise = controller.acquire("background").then((lease) => {
      backgroundTwoAdmitted = true;
      return lease;
    });

    await Promise.resolve();
    assert.equal(backgroundTwoAdmitted, false);

    const foreground = await controller.acquire("foreground");
    assert.equal(controller.snapshot().activeForeground, 1);
    assert.equal(controller.snapshot().queuedBackground, 1);

    foreground.release();
    backgroundOne.release();
    const backgroundTwo = await backgroundTwoPromise;
    backgroundTwo.release();
  });

  it("rejects a queued request promptly when its AbortSignal is cancelled", async () => {
    const controller = new AiAdmissionController({
      maxConcurrent: 1,
      maxBackgroundConcurrent: 1,
      reservedForeground: 0,
    });
    const active = await controller.acquire("background");
    const abortController = new AbortController();
    const queued = controller.acquire("foreground", abortController.signal);

    abortController.abort("client disconnected");

    await assert.rejects(queued, (error: unknown) => {
      return error instanceof Error && error.name === "AbortError";
    });
    assert.equal(controller.snapshot().queuedForeground, 0);
    active.release();
  });
});

describe("provider error propagation and provider-neutral telemetry", () => {
  it("rejects empty successful replies and propagates streaming provider failures", async () => {
    const empty = withAiHarness(
      mockedProvider({
        async generateResponse() {
          return "";
        },
      }),
      { callSite: "test.empty", priority: "foreground" },
    );
    await assert.rejects(
      empty.generateResponse("system", [{ role: "user", content: "hello" }]),
      /empty response/i,
    );

    const failed = withAiHarness(
      mockedProvider({
        async *streamResponse() {
          throw new Error("synthetic provider outage");
        },
      }),
      { callSite: "test.failure", priority: "foreground" },
    );
    await assert.rejects(async () => {
      for await (const _chunk of failed.streamResponse("system", [
        { role: "user", content: "hello" },
      ])) {
        // No chunks expected.
      }
    }, /synthetic provider outage/);
  });

  it("reports TTFT, queue, retry, and prompt-budget fields without provider-specific names", async () => {
    const telemetry: AiHarnessTelemetry[] = [];
    const provider = mockedProvider({
      async *streamResponse(
        _systemPrompt,
        _messages,
        _onUsage,
        options?: GenerationOptions,
      ) {
        options?.onEvent?.({
          type: "retry",
          attempt: 1,
          delayMs: 0,
          reason: "synthetic transient failure",
        });
        yield "first token";
      },
    });
    const wrapped = withAiHarness(provider, {
      callSite: "sage_chat",
      priority: "foreground",
      promptBudget: {
        maxInputTokens: 7_000,
        estimatedInputTokens: 412,
        systemTokens: 300,
        messageTokens: 112,
        currentMessageTokens: 12,
        droppedMessages: 3,
        duplicateCurrentMessagesRemoved: 1,
        overBudget: false,
      },
      telemetrySink: (event) => telemetry.push(event),
    });

    const chunks: string[] = [];
    for await (const chunk of wrapped.streamResponse("system", [
      { role: "user", content: "hello" },
    ])) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, ["first token"]);
    assert.equal(telemetry.length, 1);
    assert.equal(telemetry[0].provider, "mock-provider");
    assert.equal(telemetry[0].callSite, "sage_chat");
    assert.equal(telemetry[0].priority, "foreground");
    assert.equal(telemetry[0].retryCount, 1);
    assert.ok(telemetry[0].queueWaitMs >= 0);
    assert.ok((telemetry[0].ttftMs ?? -1) >= 0);
    assert.equal(telemetry[0].promptBudget?.estimatedInputTokens, 412);
    assert.equal(telemetry[0].promptBudget?.duplicateCurrentMessagesRemoved, 1);
  });
});
