import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TokenVault } from "./deidentify";
import { withDeidentification } from "./with-deidentification";
import type {
  AIProvider,
  ChatMessage,
  GenerationOptions,
  OnUsage,
  ToolCallHandler,
  ToolDeclaration,
  ToolStreamEvent,
  ToolStreamOptions,
  TokenUsage,
} from "./types";

const USAGE: TokenUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, source: "provider" };

interface RecordedCall {
  method: string;
  systemPrompt: string;
  messages: ChatMessage[];
  onUsage?: OnUsage;
  options?: GenerationOptions | ToolStreamOptions;
  tools?: ToolDeclaration[];
}

/**
 * Records exactly what it was handed and emits scripted output. `script` for
 * streamWithTools drives events; a `{ call }` entry invokes the handler the
 * decorator supplied and records the handler's (pseudonymized) return value.
 */
class FakeProvider implements AIProvider {
  readonly name = "fake";
  calls: RecordedCall[] = [];
  handlerReturns: unknown[] = [];
  text = "Hi [STUDENT_NAME], mail [STUDENT_EMAIL]";
  chunks: string[] = ["Hi [STU", "DENT_NA", "ME], mail [STUDENT_EMAIL]"];
  structured = '{"greeting":"Hi [STUDENT_NAME]","email":"[STUDENT_EMAIL]"}';
  toolScript: Array<ToolStreamEvent | { call: { callId: string; name: string; args: Record<string, unknown> } } | { throw: Error }> = [];
  streamThrowAfter: string[] | null = null;
  streamWithTools?: AIProvider["streamWithTools"];

  constructor(withTools: boolean) {
    if (withTools) {
      this.streamWithTools = async function* (
        this: FakeProvider,
        systemPrompt: string,
        messages: ChatMessage[],
        tools: ToolDeclaration[],
        onToolCall: ToolCallHandler,
        options?: ToolStreamOptions,
      ): AsyncGenerator<ToolStreamEvent> {
        this.calls.push({ method: "streamWithTools", systemPrompt, messages, options, tools });
        for (const step of this.toolScript) {
          if ("throw" in step) throw step.throw;
          if ("call" in step) {
            const result = await onToolCall(step.call);
            this.handlerReturns.push(result);
            yield {
              kind: "tool_result",
              callId: step.call.callId,
              name: step.call.name,
              status: result.status,
              summary: result.summary,
              response: result.response,
            };
            continue;
          }
          yield step;
        }
        options?.onUsage?.(USAGE);
      }.bind(this);
    }
  }

  async generateResponse(systemPrompt: string, messages: ChatMessage[], onUsage?: OnUsage, options?: GenerationOptions) {
    this.calls.push({ method: "generateResponse", systemPrompt, messages, onUsage, options });
    onUsage?.(USAGE);
    return this.text;
  }

  async *streamResponse(systemPrompt: string, messages: ChatMessage[], onUsage?: OnUsage, options?: GenerationOptions) {
    this.calls.push({ method: "streamResponse", systemPrompt, messages, onUsage, options });
    if (this.streamThrowAfter) {
      for (const c of this.streamThrowAfter) yield c;
      throw new Error("provider exploded");
    }
    for (const c of this.chunks) yield c;
    onUsage?.(USAGE);
  }

  async generateStructuredResponse(systemPrompt: string, messages: ChatMessage[], onUsage?: OnUsage, options?: GenerationOptions) {
    this.calls.push({ method: "generateStructuredResponse", systemPrompt, messages, onUsage, options });
    onUsage?.(USAGE);
    return this.structured;
  }
}

function vault(): TokenVault {
  return TokenVault.fromIdentity({
    studentName: "Jordan Lee",
    studentEmail: "jordan.lee@example.com",
    rosterNames: ["Lee Park"],
  });
}

const SYSTEM = "You are coaching Jordan Lee (jordan.lee@example.com). Classmate: Lee Park.";
const MESSAGES: ChatMessage[] = [
  { role: "user", content: "hi, I'm Jordan Lee and I typed [PERSON_1] on purpose" },
  { role: "model", content: "Hello Jordan Lee! Lee Park is in your class. [PERSON_1] stays here." },
  { role: "user", content: "what is my email? jordan.lee@example.com" },
];

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

function assertNoValues(text: string): void {
  for (const value of ["Jordan", "jordan.lee@example.com", "Lee Park"]) {
    assert.ok(!text.includes(value), `outbound text leaks ${value}: ${text}`);
  }
}

// ─── Rule 8: empty vault is the identity ─────────────────────────────────────

describe("withDeidentification with an empty vault (rule 8)", () => {
  it("returns the original provider object", () => {
    const provider = new FakeProvider(true);
    const wrapped = withDeidentification(provider, TokenVault.fromIdentity({}));
    assert.equal(wrapped, provider);
  });
});

// ─── Rule 7: decorator shape ─────────────────────────────────────────────────

describe("withDeidentification shape (rule 7)", () => {
  it("keeps the provider name and capability-detects streamWithTools", () => {
    const withTools = withDeidentification(new FakeProvider(true), vault());
    const without = withDeidentification(new FakeProvider(false), vault());
    assert.equal(withTools.name, "fake");
    assert.equal(Boolean(withTools.streamWithTools), true);
    assert.equal(Boolean(without.streamWithTools), false);
    assert.equal("streamWithTools" in without, false);
  });
});

describe("withDeidentification outbound messages (rules 5 and 7)", () => {
  it("pseudonymizes the system prompt and every message, neutralizing user-authored token shapes only", async () => {
    const provider = new FakeProvider(false);
    const wrapped = withDeidentification(provider, vault());
    await wrapped.generateResponse(SYSTEM, MESSAGES);
    const call = provider.calls[0];
    assert.equal(call.systemPrompt, "You are coaching [STUDENT_NAME] ([STUDENT_EMAIL]). Classmate: [PERSON_1].");
    assertNoValues(call.systemPrompt);
    assert.deepEqual(call.messages, [
      { role: "user", content: "hi, I'm [STUDENT_NAME] and I typed (PERSON_1) on purpose" },
      { role: "model", content: "Hello [STUDENT_NAME]! [PERSON_1] is in your class. [PERSON_1] stays here." },
      { role: "user", content: "what is my email? [STUDENT_EMAIL]" },
    ]);
    for (const m of call.messages) assertNoValues(m.content);
  });

  it("does not mutate the caller's message objects", async () => {
    const provider = new FakeProvider(false);
    const wrapped = withDeidentification(provider, vault());
    const messages = MESSAGES.map((m) => ({ ...m }));
    await wrapped.generateResponse(SYSTEM, messages);
    assert.deepEqual(messages, MESSAGES);
  });
});

describe("withDeidentification.generateResponse", () => {
  it("re-hydrates the reply and passes onUsage and options through untouched", async () => {
    const provider = new FakeProvider(false);
    const wrapped = withDeidentification(provider, vault());
    const seen: TokenUsage[] = [];
    const options: GenerationOptions = { temperature: 0 };
    const reply = await wrapped.generateResponse(SYSTEM, MESSAGES, (u) => seen.push(u), options);
    assert.equal(reply, "Hi Jordan Lee, mail jordan.lee@example.com");
    assert.deepEqual(seen, [USAGE]);
    assert.equal(provider.calls[0].options, options, "options object passed by reference");
  });

  it("leaves a model-invented token-shaped string alone (loud placeholder, never a guess)", async () => {
    const provider = new FakeProvider(false);
    provider.text = "Hi [STUDENT_NAME], your teacher is [TEACHER_NAME_1]";
    const wrapped = withDeidentification(provider, vault());
    assert.equal(await wrapped.generateResponse(SYSTEM, MESSAGES), "Hi Jordan Lee, your teacher is [TEACHER_NAME_1]");
  });

  it("does not re-hydrate a token the user forged and the model echoed", async () => {
    const provider = new FakeProvider(false);
    provider.text = "You typed (PERSON_1).";
    const wrapped = withDeidentification(provider, vault());
    assert.equal(await wrapped.generateResponse(SYSTEM, MESSAGES), "You typed (PERSON_1).");
  });
});

describe("withDeidentification.streamResponse", () => {
  it("re-hydrates a token split across chunks and never emits a half token", async () => {
    const provider = new FakeProvider(false);
    const wrapped = withDeidentification(provider, vault());
    const seen: TokenUsage[] = [];
    const chunks = await collect(wrapped.streamResponse(SYSTEM, MESSAGES, (u) => seen.push(u)));
    assert.equal(chunks.join(""), "Hi Jordan Lee, mail jordan.lee@example.com");
    for (const c of chunks) assert.ok(!/\[STUDENT_[A-Z]*\]?/.test(c), `half token emitted: ${JSON.stringify(c)}`);
    assert.deepEqual(seen, [USAGE]);
  });

  it("does not emit the carry when the provider throws mid-stream (rule 9)", async () => {
    const provider = new FakeProvider(false);
    provider.streamThrowAfter = ["Hi [STUDENT_"];
    const wrapped = withDeidentification(provider, vault());
    const received: string[] = [];
    await assert.rejects(async () => {
      for await (const c of wrapped.streamResponse(SYSTEM, MESSAGES)) received.push(c);
    }, /provider exploded/);
    assert.deepEqual(received, ["Hi "]);
  });
});

describe("withDeidentification.generateStructuredResponse", () => {
  it("re-hydrates tokens inside JSON string values and the JSON stays parseable", async () => {
    const provider = new FakeProvider(false);
    const wrapped = withDeidentification(provider, vault());
    const raw = await wrapped.generateStructuredResponse(SYSTEM, MESSAGES);
    const parsed = JSON.parse(raw) as { greeting: string; email: string };
    assert.deepEqual(parsed, { greeting: "Hi Jordan Lee", email: "jordan.lee@example.com" });
  });

  it("keeps the JSON valid when a value contains quotes, backslashes, or newlines", async () => {
    const provider = new FakeProvider(false);
    provider.structured = '{"greeting":"Hi [STUDENT_NAME]"}';
    const v = TokenVault.fromIdentity({ studentName: 'Jo "JJ"\nO\\Neil' });
    const wrapped = withDeidentification(provider, v);
    const parsed = JSON.parse(await wrapped.generateStructuredResponse(SYSTEM, [])) as { greeting: string };
    assert.equal(parsed.greeting, 'Hi Jo "JJ"\nO\\Neil');
  });
});

describe("withDeidentification.streamWithTools", () => {
  const TOOLS: ToolDeclaration[] = [
    { name: "find_student", description: "look up", parameters: { type: "object", properties: {} } },
  ];

  it("re-hydrates text, tool args before the tool runs, and tool results for the caller; pseudonymizes what goes back to the model", async () => {
    const provider = new FakeProvider(true);
    provider.toolScript = [
      { kind: "text", text: "Looking up [STU" },
      { kind: "text", text: "DENT_NAME] now" },
      { kind: "tool_call", callId: "c1", name: "find_student", args: { name: "[STUDENT_NAME]", nested: { emails: ["[STUDENT_EMAIL]"] } } },
      { call: { callId: "c1", name: "find_student", args: { name: "[STUDENT_NAME]", nested: { emails: ["[STUDENT_EMAIL]"] } } } },
      { kind: "text", text: "Done, [PERSON_1] is a classmate. [PERSON_9] unknown." },
      { kind: "done", reason: "complete" },
    ];
    const wrapped = withDeidentification(provider, vault());

    const handlerSaw: Array<{ callId: string; name: string; args: Record<string, unknown> }> = [];
    const handlerReturn = {
      response: { found: "Jordan Lee", classmates: ["Lee Park"], count: 1 },
      summary: "Found Jordan Lee and Lee Park",
      status: "success" as const,
    };
    const onToolCall: ToolCallHandler = async (call) => {
      handlerSaw.push(call);
      return handlerReturn;
    };
    const seen: TokenUsage[] = [];
    const options: ToolStreamOptions = { maxHops: 3, temperature: 0, onUsage: (u) => seen.push(u) };

    const events = await collect(wrapped.streamWithTools!(SYSTEM, MESSAGES, TOOLS, onToolCall, options));

    // Outbound: pseudonymized, tools and options threaded.
    const call = provider.calls[0];
    assertNoValues(call.systemPrompt);
    for (const m of call.messages) assertNoValues(m.content);
    assert.equal(call.tools, TOOLS);
    assert.equal((call.options as ToolStreamOptions).maxHops, 3);
    assert.equal((call.options as ToolStreamOptions).temperature, 0);
    assert.deepEqual(seen, [USAGE], "onUsage reaches the caller");

    // The tool ran on REAL values, re-hydrated before execution.
    assert.deepEqual(handlerSaw, [
      { callId: "c1", name: "find_student", args: { name: "Jordan Lee", nested: { emails: ["jordan.lee@example.com"] } } },
    ]);

    // The provider (and so the model) got the handler's result pseudonymized.
    assert.deepEqual(provider.handlerReturns, [
      {
        response: { found: "[STUDENT_NAME]", classmates: ["[PERSON_1]"], count: 1 },
        summary: "Found [STUDENT_NAME] and [PERSON_1]",
        status: "success",
      },
    ]);

    // The caller sees re-hydrated text (carry flushed before the tool_call so
    // order is preserved), re-hydrated args, the handler's own result, and done.
    const texts = events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text).join("");
    assert.equal(texts, "Looking up Jordan Lee nowDone, Lee Park is a classmate. [PERSON_9] unknown.");
    const kinds = events.map((e) => e.kind);
    assert.deepEqual(kinds.filter((k) => k !== "text"), ["tool_call", "tool_result", "done"]);
    const firstNonText = kinds.indexOf("tool_call");
    const textBefore = events
      .slice(0, firstNonText)
      .map((e) => (e as { text: string }).text)
      .join("");
    assert.equal(textBefore, "Looking up Jordan Lee now", "carry is flushed before the tool_call event");
    for (const e of events) {
      if (e.kind === "text") assert.ok(!e.text.includes("[STUDENT"), e.text);
    }

    const toolCall = events.find((e) => e.kind === "tool_call");
    assert.deepEqual(toolCall, {
      kind: "tool_call",
      callId: "c1",
      name: "find_student",
      args: { name: "Jordan Lee", nested: { emails: ["jordan.lee@example.com"] } },
    });

    const toolResult = events.find((e) => e.kind === "tool_result");
    assert.deepEqual(toolResult, {
      kind: "tool_result",
      callId: "c1",
      name: "find_student",
      status: "success",
      summary: "Found Jordan Lee and Lee Park",
      response: { found: "Jordan Lee", classmates: ["Lee Park"], count: 1 },
    });

    assert.deepEqual(events.at(-1), { kind: "done", reason: "complete" });
  });

  it("re-hydrates a tool_result the provider synthesized without calling the handler", async () => {
    const provider = new FakeProvider(true);
    provider.toolScript = [
      { kind: "tool_result", callId: "x", name: "find_student", status: "error", summary: "No tool for [STUDENT_NAME]", response: { who: "[STUDENT_NAME]" } },
      { kind: "done", reason: "max_hops" },
    ];
    const wrapped = withDeidentification(provider, vault());
    const events = await collect(wrapped.streamWithTools!(SYSTEM, [], [], async () => ({ response: null, summary: "", status: "success" })));
    assert.deepEqual(events[0], {
      kind: "tool_result",
      callId: "x",
      name: "find_student",
      status: "error",
      summary: "No tool for Jordan Lee",
      response: { who: "Jordan Lee" },
    });
    assert.deepEqual(events[1], { kind: "done", reason: "max_hops" });
  });

  it("does not emit the carry when the provider throws mid-stream (rule 9)", async () => {
    const provider = new FakeProvider(true);
    provider.toolScript = [{ kind: "text", text: "Hi [STUDENT_" }, { throw: new Error("provider exploded") }];
    const wrapped = withDeidentification(provider, vault());
    const received: ToolStreamEvent[] = [];
    await assert.rejects(async () => {
      for await (const e of wrapped.streamWithTools!(SYSTEM, [], [], async () => ({ response: null, summary: "", status: "success" }))) {
        received.push(e);
      }
    }, /provider exploded/);
    assert.deepEqual(received, [{ kind: "text", text: "Hi " }]);
  });

  it("flushes a trailing carry when the provider ends without a done event", async () => {
    const provider = new FakeProvider(true);
    provider.toolScript = [{ kind: "text", text: "bye [" }];
    const wrapped = withDeidentification(provider, vault());
    const events = await collect(wrapped.streamWithTools!(SYSTEM, [], [], async () => ({ response: null, summary: "", status: "success" })));
    assert.deepEqual(events, [
      { kind: "text", text: "bye " },
      { kind: "text", text: "[" },
    ]);
  });
});
