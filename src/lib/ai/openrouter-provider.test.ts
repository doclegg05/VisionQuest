import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OPENROUTER_PRIVACY,
  OpenRouterError,
  OpenRouterProvider,
  buildRequestBody,
  classifyOpenRouterFailure,
} from "./openrouter-provider";
import type { ChatMessage, ToolDeclaration, ToolStreamEvent, TokenUsage } from "./types";

const KEY = "sk-or-v1-test-key-0123456789abcdef";
const MODEL = "google/gemini-3.1-flash-lite";
const MESSAGES: ChatMessage[] = [
  { role: "user", content: "q1" },
  { role: "model", content: "a1" },
  { role: "user", content: "q2" },
];
const encoder = new TextEncoder();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sseResponse(events: unknown[], options: { comments?: string[]; splitAt?: number } = {}): Response {
  const text = [
    ...(options.comments ?? []).map((comment) => `: ${comment}\n\n`),
    ...events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`),
    "data: [DONE]\n\n",
  ].join("");
  const parts = options.splitAt === undefined ? [text] : [text.slice(0, options.splitAt), text.slice(options.splitAt)];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function recordingFetch(responses: Array<() => Response>) {
  const bodies: Array<Record<string, unknown>> = [];
  const queue = [...responses];
  const fetchImpl: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = queue.shift();
    if (!next) throw new Error("no more fake responses");
    return next();
  };
  return { fetchImpl, bodies };
}

function makeProvider(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return new OpenRouterProvider(KEY, MODEL, { fetchImpl, sleep: async () => {}, ...extra });
}

async function drain<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of generator) out.push(item);
  return out;
}

const completion = (content: string, finishReason = "stop") => ({
  provider: "Google",
  model: MODEL,
  choices: [{ message: { role: "assistant", content }, finish_reason: finishReason }],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
});
const textChunk = (content: string) => ({ provider: "Google", model: MODEL, choices: [{ delta: { content } }] });
const stopChunk = (promptTokens: number, completionTokens: number) => ({
  choices: [{ delta: {}, finish_reason: "stop" }],
  usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
});

describe("buildRequestBody", () => {
  it("ends with the privacy fields and drops identifying fields", () => {
    const body = buildRequestBody("m", "sys", [{ role: "user", content: "hi" }], {
      user: "student-1",
      session_id: "s-1",
      plugins: [{ id: "web" }],
      provider: { zdr: false },
      temperature: 0,
    });
    assert.deepEqual(body.provider, { ...OPENROUTER_PRIVACY });
    for (const key of ["user", "session_id", "plugins"]) assert.equal(key in body, false, key);
    assert.equal(body.temperature, 0);
    assert.deepEqual((body.messages as unknown[])[0], { role: "system", content: "sys" });
  });
});

describe("classifyOpenRouterFailure", () => {
  it("separates credits, refusals, rate limits, outages and bad requests", () => {
    assert.equal(classifyOpenRouterFailure(402, ""), "credits");
    assert.equal(classifyOpenRouterFailure(403, '{"error":{"code":"openrouter_key_limit"}}'), "credits");
    assert.equal(classifyOpenRouterFailure(403, '{"error":{"code":"content_policy_violation"}}'), "refused");
    assert.equal(classifyOpenRouterFailure(429, ""), "rate_limited");
    assert.equal(classifyOpenRouterFailure(408, ""), "unavailable");
    assert.equal(classifyOpenRouterFailure(503, ""), "unavailable");
    assert.equal(classifyOpenRouterFailure(400, ""), "bad_request");
    assert.equal(classifyOpenRouterFailure(401, ""), "bad_request");
  });
});

describe("OpenRouterProvider requests", () => {
  it("refuses to construct without a key", () => {
    assert.throws(() => new OpenRouterProvider("", MODEL), OpenRouterError);
  });

  it("sends the privacy fields and maps roles on every request type", async () => {
    const { fetchImpl, bodies } = recordingFetch([
      () => jsonResponse(200, completion("a")),
      () => jsonResponse(200, completion('{"x":1}')),
      () => sseResponse([textChunk("hi"), stopChunk(5, 1)]),
      () => sseResponse([textChunk("ok"), stopChunk(5, 1)]),
    ]);
    const provider = makeProvider(fetchImpl);
    await provider.generateResponse("sys", MESSAGES);
    await provider.generateStructuredResponse("sys", MESSAGES);
    await drain(provider.streamResponse("sys", MESSAGES));
    await drain(provider.streamWithTools("sys", MESSAGES, [], async () => ({ response: null, summary: "", status: "success" })));

    assert.equal(bodies.length, 4);
    for (const body of bodies) {
      assert.deepEqual(body.provider, { ...OPENROUTER_PRIVACY });
      for (const key of ["user", "session_id", "plugins"]) assert.equal(key in body, false, key);
      assert.equal(body.model, MODEL);
      const roles = (body.messages as Array<{ role: string }>).map((message) => message.role);
      assert.deepEqual(roles, ["system", "user", "assistant", "user"]);
    }
    assert.deepEqual(bodies[1].response_format, { type: "json_object" });
    assert.equal(bodies[2].stream, true);
  });
});

describe("OpenRouterProvider non-streaming", () => {
  it("returns the text and reports provider usage and the upstream provider", async () => {
    const { fetchImpl } = recordingFetch([() => jsonResponse(200, completion("hello"))]);
    const usages: TokenUsage[] = [];
    const metas: unknown[] = [];
    const provider = makeProvider(fetchImpl, { onResponseMeta: (meta: unknown) => metas.push(meta) });
    const text = await provider.generateResponse("sys", MESSAGES, (usage) => usages.push(usage));
    assert.equal(text, "hello");
    assert.deepEqual(usages, [{ inputTokens: 10, outputTokens: 2, totalTokens: 12, source: "provider" }]);
    assert.deepEqual(metas, [{ upstreamProvider: "Google", model: MODEL }]);
  });

  it("treats an empty reply as an error, never an empty string", async () => {
    const { fetchImpl } = recordingFetch([() => jsonResponse(200, completion("", "length"))]);
    await assert.rejects(makeProvider(fetchImpl).generateResponse("sys", MESSAGES), /no text \(finish_reason: length\)/);
  });

  it("retries 429 and 5xx with the Gemini backoff, then succeeds", async () => {
    const slept: number[] = [];
    const { fetchImpl, bodies } = recordingFetch([
      () => jsonResponse(429, { error: { message: "slow down" } }),
      () => jsonResponse(503, { error: { message: "overloaded" } }),
      () => jsonResponse(200, completion("ok")),
    ]);
    const provider = makeProvider(fetchImpl, { sleep: async (ms: number) => { slept.push(ms); } });
    assert.equal(await provider.generateResponse("sys", MESSAGES), "ok");
    assert.equal(bodies.length, 3);
    assert.deepEqual(slept, [500, 1500]);
  });

  it("gives up after three attempts", async () => {
    const { fetchImpl, bodies } = recordingFetch([
      () => jsonResponse(503, {}),
      () => jsonResponse(503, {}),
      () => jsonResponse(503, {}),
    ]);
    await assert.rejects(
      makeProvider(fetchImpl).generateResponse("sys", MESSAGES),
      (error) => error instanceof OpenRouterError && error.kind === "unavailable" && error.status === 503,
    );
    assert.equal(bodies.length, 3);
  });

  it("does not retry a bad request and keeps the key and body out of the message", async () => {
    const { fetchImpl, bodies } = recordingFetch([
      () => jsonResponse(400, { error: { message: `secret detail for ${KEY}` } }),
    ]);
    await assert.rejects(makeProvider(fetchImpl).generateResponse("sys", MESSAGES), (error) => {
      assert.ok(error instanceof OpenRouterError);
      assert.equal(error.kind, "bad_request");
      assert.equal(error.message.includes(KEY), false);
      assert.equal(error.message.includes("secret detail"), false);
      return true;
    });
    assert.equal(bodies.length, 1);
  });
});

describe("OpenRouterProvider streaming", () => {
  it("yields text, skips keep-alive comments, reassembles split lines and reports final usage", async () => {
    const { fetchImpl } = recordingFetch([
      () => sseResponse([textChunk("Hel"), textChunk("lo"), stopChunk(12, 3)], {
        comments: ["OPENROUTER PROCESSING"],
        splitAt: 60,
      }),
    ]);
    const usages: TokenUsage[] = [];
    const chunks = await drain(makeProvider(fetchImpl).streamResponse("sys", MESSAGES, (usage) => usages.push(usage)));
    assert.deepEqual(chunks, ["Hel", "lo"]);
    assert.deepEqual(usages, [{ inputTokens: 12, outputTokens: 3, totalTokens: 15, source: "provider" }]);
  });

  it("throws on a mid-stream error after text was sent, without retrying", async () => {
    const { fetchImpl, bodies } = recordingFetch([
      () => sseResponse([textChunk("partial"), { choices: [{ delta: {}, finish_reason: "error" }] }]),
      () => sseResponse([textChunk("should not be fetched")]),
    ]);
    const seen: string[] = [];
    await assert.rejects(async () => {
      for await (const chunk of makeProvider(fetchImpl).streamResponse("sys", MESSAGES)) seen.push(chunk);
    }, /mid-stream/);
    assert.deepEqual(seen, ["partial"]);
    assert.equal(bodies.length, 1);
  });

  it("treats a stream with no text as an error", async () => {
    const { fetchImpl } = recordingFetch([() => sseResponse([stopChunk(5, 0)])]);
    await assert.rejects(drain(makeProvider(fetchImpl).streamResponse("sys", MESSAGES)), /no text/);
  });

  it("times out a stalled stream", async () => {
    const hanging = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(textChunk("first"))}\n\n`));
          },
        }),
        { status: 200 },
      );
    const { fetchImpl } = recordingFetch([hanging]);
    await assert.rejects(
      drain(makeProvider(fetchImpl, { streamStallTimeoutMs: 20 }).streamResponse("sys", MESSAGES)),
      /stalled/,
    );
  });
});

describe("OpenRouterProvider tool loop", () => {
  const TOOLS: ToolDeclaration[] = [
    {
      name: "lookup_goals",
      description: "List the student's goals.",
      parameters: { type: "object", properties: { limit: { type: "integer" } } },
    },
  ];
  const REASONING = [{ type: "reasoning.encrypted", data: "sig-1" }];
  const toolHop = (args: string[]) => () =>
    sseResponse([
      {
        provider: "Google",
        choices: [
          {
            delta: {
              reasoning_details: REASONING,
              tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup_goals", arguments: args[0] } }],
            },
          },
        ],
      },
      ...args.slice(1).map((part) => ({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: part } }] } }] })),
      { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } },
    ]);
  const answerHop = () => sseResponse([textChunk("Here you go"), stopChunk(20, 3)]);
  const handler = async () => ({ response: { goals: [] }, summary: "0 goals", status: "success" as const });

  it("runs the tool, sends reasoning_details back unchanged, and reports accumulated usage", async () => {
    const { fetchImpl, bodies } = recordingFetch([toolHop(['{"lim', 'it":2}']), answerHop]);
    const calls: unknown[] = [];
    const usages: TokenUsage[] = [];
    const events = await drain(
      makeProvider(fetchImpl).streamWithTools(
        "sys",
        [{ role: "user", content: "Show my goals" }],
        TOOLS,
        async (call) => {
          calls.push(call);
          return handler();
        },
        { onUsage: (usage) => usages.push(usage) },
      ),
    );

    assert.deepEqual(calls, [{ callId: "call_1", name: "lookup_goals", args: { limit: 2 } }]);
    assert.deepEqual(
      events.map((event: ToolStreamEvent) => event.kind),
      ["tool_call", "tool_result", "text", "done"],
    );
    assert.deepEqual(events.at(-1), { kind: "done", reason: "complete" });
    assert.deepEqual(bodies[0].tools, [
      { type: "function", function: { name: "lookup_goals", description: TOOLS[0].description, parameters: TOOLS[0].parameters } },
    ]);
    assert.deepEqual((bodies[1].messages as unknown[]).slice(2), [
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup_goals", arguments: '{"limit":2}' } }],
        reasoning_details: REASONING,
      },
      { role: "tool", tool_call_id: "call_1", content: JSON.stringify({ goals: [], _summary: "0 goals" }) },
    ]);
    assert.deepEqual(usages, [{ inputTokens: 20, outputTokens: 7, totalTokens: 27, source: "provider" }]);
  });

  it("gives a parameterless tool call an empty object", async () => {
    const { fetchImpl } = recordingFetch([toolHop([""]), answerHop]);
    const calls: Array<{ args: Record<string, unknown> }> = [];
    await drain(
      makeProvider(fetchImpl).streamWithTools("sys", [{ role: "user", content: "q" }], TOOLS, async (call) => {
        calls.push(call);
        return handler();
      }),
    );
    assert.deepEqual(calls[0].args, {});
  });

  it("ends the turn when tool arguments are not JSON", async () => {
    const { fetchImpl } = recordingFetch([toolHop(["{not json"])]);
    await assert.rejects(
      drain(makeProvider(fetchImpl).streamWithTools("sys", [{ role: "user", content: "q" }], TOOLS, handler)),
      (error) => error instanceof OpenRouterError && error.kind === "bad_request",
    );
  });

  it("stops at the round cap", async () => {
    const { fetchImpl, bodies } = recordingFetch([toolHop(["{}"]), toolHop(["{}"])]);
    const events = await drain(
      makeProvider(fetchImpl).streamWithTools("sys", [{ role: "user", content: "q" }], TOOLS, handler, { maxHops: 2 }),
    );
    assert.deepEqual(events.at(-1), { kind: "done", reason: "max_hops" });
    assert.equal(bodies.length, 2);
  });
});
