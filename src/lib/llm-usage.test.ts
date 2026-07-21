/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { AIProvider, ChatMessage, TokenUsage, ToolCallHandler, ToolStreamEvent } from "./ai/types";
import { SAGE_PROMPT_REVISION } from "./sage/prompt-revision";

const mockCreate = mock.fn(async () => undefined) as any;

mock.module("./db", {
  namedExports: {
    prisma: {
      llmCallLog: {
        get create() {
          return mockCreate;
        },
      },
    },
  },
});

let withUsageLogging: typeof import("./llm-usage").withUsageLogging;

before(async () => {
  ({ withUsageLogging } = await import("./llm-usage"));
});

beforeEach(() => {
  mockCreate.mock.resetCalls();
});

function loggedRows(): Array<{ studentId: string | null; callSite: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; promptRevision: string | null }> {
  return mockCreate.mock.calls.map((call: { arguments: unknown[] }) => (call.arguments[0] as { data: unknown }).data);
}

/** Minimal fake provider — only the methods a given test exercises need real bodies. */
function fakeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    name: "fake",
    generateResponse: mock.fn(async () => "unused") as any,
    streamResponse: (async function* () {
      yield "unused";
    }) as any,
    generateStructuredResponse: mock.fn(async () => "{}") as any,
    ...overrides,
  };
}

const MESSAGES: ChatMessage[] = [{ role: "user", content: "Hi there" }];

describe("withUsageLogging", () => {
  it("generateResponse: logs one row with real usage when the provider reports it via onUsage", async () => {
    const provider = fakeProvider({
      generateResponse: (mock.fn(async (_sys: string, _msgs: ChatMessage[], onUsage?: (u: TokenUsage) => void) => {
        onUsage?.({ inputTokens: 10, outputTokens: 5, totalTokens: 15, source: "provider" });
        return "Hello!";
      }) as any),
    });

    const logged = withUsageLogging(provider, { studentId: "student-1", callSite: "sage_post.goals" });
    const result = await logged.generateResponse("sys", MESSAGES);

    assert.equal(result, "Hello!");
    assert.equal(mockCreate.mock.callCount(), 1);
    const [row] = loggedRows();
    assert.equal(row.studentId, "student-1");
    assert.equal(row.callSite, "sage_post.goals");
    assert.equal(row.model, "fake");
    assert.equal(row.inputTokens, 10);
    assert.equal(row.outputTokens, 5);
    assert.equal(row.totalTokens, 15);
  });

  it("generateResponse: falls back to estimating from chars when the provider never calls onUsage", async () => {
    const provider = fakeProvider({
      generateResponse: (mock.fn(async () => "A reply") as any),
    });

    const logged = withUsageLogging(provider, { studentId: null, callSite: "sage_post.mood" });
    await logged.generateResponse("system prompt text", MESSAGES);

    assert.equal(mockCreate.mock.callCount(), 1);
    const [row] = loggedRows();
    assert.equal(row.studentId, null);
    assert.ok(row.inputTokens > 0);
    assert.ok(row.outputTokens > 0);
  });

  it("streamResponse: logs one row after the stream completes using real usage", async () => {
    const provider = fakeProvider({
      streamResponse: ((_sys: string, _msgs: ChatMessage[], onUsage?: (u: TokenUsage) => void) => {
        async function* gen() {
          yield "chunk1";
          yield "chunk2";
          onUsage?.({ inputTokens: 20, outputTokens: 8, totalTokens: 28, source: "provider" });
        }
        return gen();
      }) as any,
    });

    const logged = withUsageLogging(provider, { studentId: "student-2", callSite: "sage_chat" });
    const chunks: string[] = [];
    for await (const chunk of logged.streamResponse("sys", MESSAGES)) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, ["chunk1", "chunk2"]);
    assert.equal(mockCreate.mock.callCount(), 1);
    const [row] = loggedRows();
    assert.equal(row.callSite, "sage_chat");
    assert.equal(row.totalTokens, 28);
  });

  it("generateStructuredResponse: logs one row with the configured callSite", async () => {
    const provider = fakeProvider({
      generateStructuredResponse: (mock.fn(async (_sys: string, _msgs: ChatMessage[], onUsage?: (u: TokenUsage) => void) => {
        onUsage?.({ inputTokens: 3, outputTokens: 1, totalTokens: 4, source: "provider" });
        return '{"goals_found":[]}';
      }) as any),
    });

    const logged = withUsageLogging(provider, { studentId: "student-3", callSite: "sage_post.discovery" });
    const result = await logged.generateStructuredResponse("sys", MESSAGES);

    assert.equal(result, '{"goals_found":[]}');
    assert.equal(mockCreate.mock.callCount(), 1);
    assert.equal(loggedRows()[0].callSite, "sage_post.discovery");
  });

  it("uses ctx.model to override the logged model name when provided", async () => {
    const provider = fakeProvider({
      generateResponse: (mock.fn(async (_sys: string, _msgs: ChatMessage[], onUsage?: (u: TokenUsage) => void) => {
        onUsage?.({ inputTokens: 1, outputTokens: 1, totalTokens: 2, source: "provider" });
        return "ok";
      }) as any),
    });

    const logged = withUsageLogging(provider, {
      studentId: "student-4",
      callSite: "sage_post.classroom",
      model: "gemma4:26b",
    });
    await logged.generateResponse("sys", MESSAGES);

    assert.equal(loggedRows()[0].model, "gemma4:26b");
  });

  it("stamps the current Sage prompt revision on every logged row by default", async () => {
    const provider = fakeProvider({
      generateResponse: (mock.fn(async (_sys: string, _msgs: ChatMessage[], onUsage?: (u: TokenUsage) => void) => {
        onUsage?.({ inputTokens: 1, outputTokens: 1, totalTokens: 2, source: "provider" });
        return "ok";
      }) as any),
    });

    const logged = withUsageLogging(provider, { studentId: "student-7", callSite: "sage_chat" });
    await logged.generateResponse("sys", MESSAGES);

    assert.equal(mockCreate.mock.callCount(), 1);
    assert.equal(loggedRows()[0].promptRevision, SAGE_PROMPT_REVISION);
  });

  it("uses ctx.promptRevision to override the stamped revision when provided", async () => {
    const provider = fakeProvider({
      generateResponse: (mock.fn(async (_sys: string, _msgs: ChatMessage[], onUsage?: (u: TokenUsage) => void) => {
        onUsage?.({ inputTokens: 1, outputTokens: 1, totalTokens: 2, source: "provider" });
        return "ok";
      }) as any),
    });

    const logged = withUsageLogging(provider, {
      studentId: "student-8",
      callSite: "sage_chat",
      promptRevision: "2099-01-01.experiment",
    });
    await logged.generateResponse("sys", MESSAGES);

    assert.equal(loggedRows()[0].promptRevision, "2099-01-01.experiment");
  });

  describe("streamWithTools passthrough", () => {
    it("exposes streamWithTools when the wrapped provider supports it, and logs one row for the whole turn", async () => {
      const provider = fakeProvider({
        streamWithTools: ((
          _sys: string,
          _msgs: ChatMessage[],
          _tools: unknown[],
          _onToolCall: ToolCallHandler,
          options?: { onUsage?: (u: TokenUsage) => void },
        ) => {
          async function* gen(): AsyncGenerator<ToolStreamEvent> {
            yield { kind: "text", text: "Hi" };
            options?.onUsage?.({ inputTokens: 30, outputTokens: 6, totalTokens: 36, source: "provider" });
            yield { kind: "done", reason: "complete" };
          }
          return gen();
        }) as any,
      });

      const logged = withUsageLogging(provider, { studentId: "student-5", callSite: "sage_chat" });
      assert.ok(logged.streamWithTools, "wrapped provider should expose streamWithTools");

      const events: ToolStreamEvent[] = [];
      for await (const event of logged.streamWithTools!("sys", MESSAGES, [], async () => ({
        response: {},
        summary: "unused",
        status: "success",
      }))) {
        events.push(event);
      }

      assert.equal(events.at(-1)?.kind, "done");
      assert.equal(mockCreate.mock.callCount(), 1);
      assert.equal(loggedRows()[0].totalTokens, 36);
    });

    it("does not synthesize streamWithTools when the wrapped provider lacks it", async () => {
      const provider = fakeProvider(); // no streamWithTools override
      const logged = withUsageLogging(provider, { studentId: "student-6", callSite: "sage_chat" });

      assert.equal(logged.streamWithTools, undefined);
    });
  });
});
