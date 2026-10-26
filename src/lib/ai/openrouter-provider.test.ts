import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import {
  OPENROUTER_PRIVACY,
  OpenRouterError,
  OpenRouterProvider,
  buildRequestBody,
  classifyOpenRouterFailure,
  normalizeToolName,
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
/** OpenRouter's reply when the model id does not exist. */
const UNKNOWN_MODEL_BODY = { error: { message: "acme/no-such-model is not a valid model ID", code: 400 }, user_id: "user_1" };
/** A request-shape rejection: the caller sent a body OpenRouter's schema refuses. */
const REQUEST_SHAPE_BODY = { error: { message: "messages.1.content: Expected string, received array", code: 400 } };

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

  it("reads a 400 whose body rejects the model id as an unknown model", () => {
    assert.equal(classifyOpenRouterFailure(400, JSON.stringify(UNKNOWN_MODEL_BODY)), "unknown_model");
    assert.equal(classifyOpenRouterFailure(400, '{"error":{"message":"Model acme/old-model not found","code":400}}'), "unknown_model");
  });

  it("keeps a 400 about the request shape a bad request, even when it names the model field", () => {
    // The evals read unknown_model as "not run"; a schema bug that mentions
    // the model field must still read as a failed run.
    assert.equal(classifyOpenRouterFailure(400, JSON.stringify(REQUEST_SHAPE_BODY)), "bad_request");
    assert.equal(classifyOpenRouterFailure(400, '{"error":{"message":"model: Expected string, received number","code":400}}'), "bad_request");
  });

  it("reads the model wording only on a 400", () => {
    assert.equal(classifyOpenRouterFailure(401, JSON.stringify(UNKNOWN_MODEL_BODY)), "bad_request");
    assert.equal(classifyOpenRouterFailure(404, JSON.stringify(UNKNOWN_MODEL_BODY)), "bad_request");
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

  it("names a connection that never happened as a network failure, and retries it", async () => {
    const dropped = () => {
      throw new TypeError("fetch failed");
    };
    const { fetchImpl, bodies } = recordingFetch([dropped, dropped, dropped]);
    await assert.rejects(
      makeProvider(fetchImpl).generateResponse("sys", MESSAGES),
      (error) => error instanceof OpenRouterError && error.kind === "network" && error.status === null,
    );
    assert.equal(bodies.length, 3);
  });

  it("keeps a timeout apart from a network failure", async () => {
    const timedOut = () => {
      const error = new Error("The operation timed out.");
      error.name = "TimeoutError";
      throw error;
    };
    const { fetchImpl } = recordingFetch([timedOut, timedOut, timedOut]);
    await assert.rejects(
      makeProvider(fetchImpl).generateResponse("sys", MESSAGES),
      (error) => error instanceof OpenRouterError && error.kind === "unavailable",
    );
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

  it("names an unknown model id without retrying and keeps the body out of the message", async () => {
    const { fetchImpl, bodies } = recordingFetch([() => jsonResponse(400, UNKNOWN_MODEL_BODY)]);
    await assert.rejects(makeProvider(fetchImpl).generateResponse("sys", MESSAGES), (error) => {
      assert.ok(error instanceof OpenRouterError);
      assert.equal(error.kind, "unknown_model");
      assert.equal(error.status, 400);
      assert.equal(error.message.includes("no-such-model"), false);
      assert.equal(error.message.includes("valid model"), false);
      return true;
    });
    assert.equal(bodies.length, 1);
  });

  it("keeps a request-shape 400 a bad request", async () => {
    const { fetchImpl } = recordingFetch([() => jsonResponse(400, REQUEST_SHAPE_BODY)]);
    await assert.rejects(
      makeProvider(fetchImpl).generateResponse("sys", MESSAGES),
      (error) => error instanceof OpenRouterError && error.kind === "bad_request" && error.status === 400,
    );
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

describe("OpenRouterProvider stream errors", () => {
  it("retries when the very first stream event is an error, before anything reached the caller", async () => {
    const { fetchImpl, bodies } = recordingFetch([
      () => sseResponse([{ error: { code: 502, message: "upstream unavailable" } }]),
      () => sseResponse([textChunk("ok"), stopChunk(5, 1)]),
    ]);
    const chunks = await drain(makeProvider(fetchImpl).streamResponse("sys", MESSAGES));
    assert.deepEqual(chunks, ["ok"]);
    assert.equal(bodies.length, 2);
  });

  it("classifies a mid-stream error by its code, so exhausted credits are not retried", async () => {
    const { fetchImpl, bodies } = recordingFetch([
      () => sseResponse([{ error: { code: 402, message: "Insufficient credits" } }]),
      () => sseResponse([textChunk("should not be fetched")]),
    ]);
    await assert.rejects(
      drain(makeProvider(fetchImpl).streamResponse("sys", MESSAGES)),
      (error) => error instanceof OpenRouterError && error.kind === "credits",
    );
    assert.equal(bodies.length, 1);
  });

  it("names an unknown model reported in the first stream event, without retrying", async () => {
    const { fetchImpl, bodies } = recordingFetch([
      () => sseResponse([UNKNOWN_MODEL_BODY]),
      () => sseResponse([textChunk("should not be fetched")]),
    ]);
    await assert.rejects(drain(makeProvider(fetchImpl).streamResponse("sys", MESSAGES)), (error) => {
      assert.ok(error instanceof OpenRouterError);
      assert.equal(error.kind, "unknown_model");
      assert.equal(error.message.includes("no-such-model"), false);
      return true;
    });
    assert.equal(bodies.length, 1);
  });
});

describe("OpenRouterProvider names the upstream finish reason", () => {
  // Google's MALFORMED_FUNCTION_CALL reaches OpenRouter clients as
  // finish_reason "error" with no error object; only native_finish_reason
  // says the model wrote an invalid tool call.
  const ended = (finishReason: string, native: unknown) => ({
    choices: [{ delta: {}, finish_reason: finishReason, native_finish_reason: native }],
  });
  const TOOLS: ToolDeclaration[] = [{ name: "lookup_goals", description: "List goals.", parameters: { type: "object", properties: {} } }];
  const noopTool = async () => ({ response: {}, summary: "ok", status: "success" as const });

  it("names it when a stream ends in error mid-way", async () => {
    const { fetchImpl } = recordingFetch([() => sseResponse([textChunk("partial"), ended("error", "MALFORMED_FUNCTION_CALL")])]);
    await assert.rejects(
      drain(makeProvider(fetchImpl).streamResponse("sys", MESSAGES)),
      /mid-stream \(native_finish_reason: MALFORMED_FUNCTION_CALL\)/,
    );
  });

  it("names it after the retries when every attempt at a tool round ends in a malformed call", async () => {
    const malformed = () => sseResponse([ended("error", "MALFORMED_FUNCTION_CALL")]);
    const { fetchImpl, bodies } = recordingFetch([malformed, malformed, malformed]);
    await assert.rejects(
      drain(makeProvider(fetchImpl).streamWithTools("sys", [{ role: "user", content: "q" }], TOOLS, noopTool)),
      /native_finish_reason: MALFORMED_FUNCTION_CALL/,
    );
    assert.equal(bodies.length, 3);
  });

  it("names it when a non-streamed reply has no text", async () => {
    const reply = { ...completion(""), choices: [{ message: { content: "" }, finish_reason: "error", native_finish_reason: "MALFORMED_FUNCTION_CALL" }] };
    const { fetchImpl } = recordingFetch([() => jsonResponse(200, reply)]);
    await assert.rejects(
      makeProvider(fetchImpl).generateResponse("sys", MESSAGES),
      /no text \(finish_reason: error, native_finish_reason: MALFORMED_FUNCTION_CALL\)/,
    );
  });

  it("names it when a streamed reply or a tool round has no text", async () => {
    const { fetchImpl } = recordingFetch([() => sseResponse([ended("stop", "SAFETY")]), () => sseResponse([ended("stop", "SAFETY")])]);
    const provider = makeProvider(fetchImpl);
    await assert.rejects(drain(provider.streamResponse("sys", MESSAGES)), /no text \(finish_reason: stop, native_finish_reason: SAFETY\)/);
    await assert.rejects(
      drain(provider.streamWithTools("sys", [{ role: "user", content: "q" }], TOOLS, noopTool)),
      /no text \(finish_reason: stop, native_finish_reason: SAFETY\)/,
    );
  });

  it("leaves out a native reason that is not a short plain token", async () => {
    const replies = ["MALFORMED FUNCTION CALL", "x".repeat(65), 42].map(
      (native) => () =>
        jsonResponse(200, { ...completion(""), choices: [{ message: { content: "" }, finish_reason: "error", native_finish_reason: native }] }),
    );
    const { fetchImpl } = recordingFetch(replies);
    const provider = makeProvider(fetchImpl);
    for (let i = 0; i < replies.length; i += 1) {
      await assert.rejects(provider.generateResponse("sys", MESSAGES), (error) => {
        assert.ok(error instanceof OpenRouterError);
        assert.equal(error.message, "OpenRouter returned no text (finish_reason: error)");
        return true;
      });
    }
  });
});

describe("normalizeToolName", () => {
  const declared = new Set(["lookup_goals", "save_job"]);

  it("strips Gemini's default_api. prefix only when the rest is a declared tool", () => {
    assert.equal(normalizeToolName("default_api.lookup_goals", declared), "lookup_goals");
    assert.equal(normalizeToolName("lookup_goals", declared), "lookup_goals");
    assert.equal(normalizeToolName("default_api.not_a_tool", declared), "default_api.not_a_tool");
    assert.equal(normalizeToolName("other_ns.save_job", declared), "other_ns.save_job");
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

  it("maps a default_api.-prefixed tool call to the declared tool, in events, the handler and the next round", async () => {
    const prefixedHop = () =>
      sseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "default_api.lookup_goals", arguments: "{}" } }],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } },
      ]);
    const { fetchImpl, bodies } = recordingFetch([prefixedHop, answerHop]);
    const handled: string[] = [];
    const events = await drain(
      makeProvider(fetchImpl).streamWithTools("sys", [{ role: "user", content: "q" }], TOOLS, async (call) => {
        handled.push(call.name);
        return handler();
      }),
    );
    assert.deepEqual(handled, ["lookup_goals"]);
    const toolCall = events.find((event) => event.kind === "tool_call");
    assert.equal(toolCall?.kind === "tool_call" ? toolCall.name : null, "lookup_goals");
    const assistant = (bodies[1].messages as Array<{ role: string; tool_calls?: Array<{ function: { name: string } }> }>).find(
      (message) => message.role === "assistant",
    );
    assert.equal(assistant?.tool_calls?.[0].function.name, "lookup_goals");
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

describe("OpenRouterProvider per-call cost", () => {
  const withCost = <T extends { usage: Record<string, unknown> }>(body: T, cost: unknown) => ({
    ...body,
    usage: { ...body.usage, cost },
  });
  const costsOf = (fetchImpl: typeof fetch) => {
    const costs: number[] = [];
    return { costs, provider: makeProvider(fetchImpl, { onCost: (usd: number) => costs.push(usd) }) };
  };

  it("reports the cost OpenRouter returns with a non-streamed reply", async () => {
    const { fetchImpl } = recordingFetch([() => jsonResponse(200, withCost(completion("hi"), 0.0012))]);
    const { costs, provider } = costsOf(fetchImpl);
    await provider.generateResponse("sys", MESSAGES);
    assert.deepEqual(costs, [0.0012]);
  });

  it("reports a streamed reply's cost once, from the final usage chunk", async () => {
    const { fetchImpl } = recordingFetch([() => sseResponse([textChunk("Hel"), textChunk("lo"), withCost(stopChunk(12, 3), 0.0005)])]);
    const { costs, provider } = costsOf(fetchImpl);
    await drain(provider.streamResponse("sys", MESSAGES));
    assert.deepEqual(costs, [0.0005]);
  });

  it("reports one cost per round of a tool loop", async () => {
    const toolRound = () =>
      sseResponse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup_goals", arguments: "{}" } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.001 } },
      ]);
    const answerRound = () => sseResponse([textChunk("Done"), withCost(stopChunk(20, 3), 0.002)]);
    const { fetchImpl } = recordingFetch([toolRound, answerRound]);
    const { costs, provider } = costsOf(fetchImpl);
    const tools: ToolDeclaration[] = [{ name: "lookup_goals", description: "List goals.", parameters: { type: "object", properties: {} } }];
    await drain(
      provider.streamWithTools("sys", [{ role: "user", content: "q" }], tools, async () => ({
        response: {},
        summary: "ok",
        status: "success" as const,
      })),
    );
    assert.deepEqual(costs, [0.001, 0.002]);
  });

  it("reports nothing when a reply carries no usable cost", async () => {
    const { fetchImpl } = recordingFetch([
      () => jsonResponse(200, completion("no cost field")),
      () => jsonResponse(200, withCost(completion("a string"), "0.01")),
      () => jsonResponse(200, withCost(completion("negative"), -1)),
      () => sseResponse([textChunk("streamed"), withCost(stopChunk(1, 1), Number.NaN)]),
    ]);
    const { costs, provider } = costsOf(fetchImpl);
    for (let i = 0; i < 3; i += 1) await provider.generateResponse("sys", MESSAGES);
    await drain(provider.streamResponse("sys", MESSAGES));
    assert.deepEqual(costs, []);
  });
});

describe("OpenRouterProvider refuses the app server", () => {
  for (const [name, value] of [
    ["NEXT_RUNTIME", "nodejs"],
    ["RENDER", "true"],
  ]) {
    it(`refuses to construct when ${name} is set`, () => {
      const previous = process.env[name];
      process.env[name] = value;
      try {
        assert.throws(
          () => new OpenRouterProvider(KEY, MODEL),
          (error) => error instanceof OpenRouterError && /eval-only/.test(error.message),
        );
      } finally {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }
    });
  }
});

describe("OpenRouterProvider key handling", () => {
  it("never exposes the key when the provider is logged or serialized", () => {
    const provider = new OpenRouterProvider("sk-or-secret-value", MODEL);
    assert.doesNotMatch(JSON.stringify(provider), /sk-or-secret-value/);
    assert.doesNotMatch(inspect(provider, { showHidden: true, depth: 5 }), /sk-or-secret-value/);
  });
});
