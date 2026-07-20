/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { mock } from "node:test";

// Regression tests for the streamWithTools hop loop, pinned at the WIRE level
// (global.fetch stub, the gemini-embedding-provider.test.ts idiom). Both bugs
// below were invisible to every eval (all ran maxHops 1) and broke hop 2
// against the real API with 400s:
//   1. ChatSession silently dropped the model's function-call turn from
//      history when the streamed response carried an empty text part
//      (isValidResponse) -> "function response turn must come immediately
//      after a function call turn".
//   2. The SDK's stream aggregation strips fields it does not know — Gemini 3
//      thoughtSignature — from functionCall parts -> "Function call is
//      missing a thought_signature".
// The provider now manages `contents` itself from the raw wire parts; these
// tests assert the hop-2 request body the API actually receives.

// Silence the provider's retry warn logs — the retry tests below trigger
// them deliberately and the assertions are on fetch-call counts, not logs.
process.env.LOG_LEVEL = "error";

mock.module("@/lib/gemini", {
  namedExports: { GEMINI_MODEL: "gemini-test" },
});

let GeminiProvider: typeof import("./gemini-provider").GeminiProvider;

before(async () => {
  ({ GeminiProvider } = await import("./gemini-provider"));
});

const originalFetch = global.fetch;
after(() => {
  global.fetch = originalFetch;
});

/** One SSE response whose single data frame carries the given model parts. */
function sseResponse(parts: any[]): Response {
  const frame = {
    candidates: [{ index: 0, content: { role: "model", parts } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  };
  return new Response(`data: ${JSON.stringify(frame)}\r\n\r\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** One plain JSON response (non-streaming :generateContent) with the given text. */
function jsonResponse(text: string): Response {
  const body = {
    candidates: [{ index: 0, content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** One non-OK JSON error response, shaped like the Gemini API's error body. */
function httpError(status: number): Response {
  return new Response(JSON.stringify({ error: { message: `scripted ${status}` } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** An SSE response that delivers one good frame, then dies mid-stream. */
function sseBodyErrorAfter(parts: any[]): Response {
  const frame = {
    candidates: [{ index: 0, content: { role: "model", parts } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  };
  const encoder = new TextEncoder();
  // Pull-based so the frame is delivered on demand BEFORE the error: erroring
  // a push-based stream discards any still-queued chunks.
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\r\n\r\n`));
      } else {
        controller.error(new Error("socket hang up"));
      }
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

let capturedBodies: any[] = [];

/** Stub fetch to script one SSE frame per hop and capture request bodies. */
function scriptHops(hops: any[][]) {
  capturedBodies = [];
  let hop = 0;
  global.fetch = (async (_url: any, init: any) => {
    capturedBodies.push(JSON.parse(init.body));
    const parts = hops[hop] ?? [{ text: "fallback" }];
    hop += 1;
    return sseResponse(parts);
  }) as any;
}

/** Stub fetch to return scripted response factories in call order (last repeats). */
function scriptSequence(factories: Array<() => Response>) {
  capturedBodies = [];
  let call = 0;
  global.fetch = (async (_url: any, init: any) => {
    capturedBodies.push(JSON.parse(init.body));
    const factory = factories[Math.min(call, factories.length - 1)];
    call += 1;
    return factory();
  }) as any;
}

/** Stub fetch to return one non-streaming JSON reply and capture request bodies. */
function scriptJson() {
  capturedBodies = [];
  global.fetch = (async (_url: any, init: any) => {
    capturedBodies.push(JSON.parse(init.body));
    return jsonResponse("ok");
  }) as any;
}

const TOOLS = [
  {
    name: "get_goals",
    description: "test tool",
    parameters: { type: "object" as const, properties: {}, required: [] },
  },
];

const OK_HANDLER = async () => ({ status: "success" as const, summary: "ok", response: { ok: true } });

async function drain(events: AsyncGenerator<any>) {
  const out = [];
  for await (const event of events) out.push(event);
  return out;
}

function run(provider: InstanceType<typeof GeminiProvider>, maxHops = 2) {
  return drain(
    provider.streamWithTools!(
      "system",
      [{ role: "user", content: "hi" }],
      TOOLS,
      OK_HANDLER,
      { maxHops },
    ),
  );
}

describe("GeminiProvider.streamWithTools hop-2 request shape", () => {
  beforeEach(() => {
    capturedBodies = [];
  });

  it("keeps the function-call turn in hop-2 contents even when the response carries an empty text part", async () => {
    scriptHops([
      // Hop 1: empty text part + a function call — the shape ChatSession's
      // isValidResponse rejects and silently drops from history.
      [{ text: "" }, { functionCall: { name: "get_goals", args: {} } }],
      [{ text: "done" }],
    ]);
    const events = await run(new GeminiProvider("test-key"));

    assert.equal(capturedBodies.length, 2, "expected two hops");
    const hop2 = capturedBodies[1].contents;
    // [user, model(functionCall), function(functionResponse)]
    assert.equal(hop2.length, 3);
    assert.equal(hop2[1].role, "model");
    assert.ok(
      hop2[1].parts.some((p: any) => p.functionCall?.name === "get_goals"),
      "model function-call turn must precede the function response",
    );
    assert.equal(hop2[2].role, "function");
    assert.ok(hop2[2].parts.every((p: any) => p.functionResponse));
    assert.ok(events.some((e) => e.kind === "tool_call" && e.name === "get_goals"));
    assert.ok(events.some((e) => e.kind === "done" && e.reason === "complete"));
  });

  it("preserves thoughtSignature on resent functionCall parts (SDK aggregation strips it)", async () => {
    scriptHops([
      [{ functionCall: { name: "get_goals", args: {} }, thoughtSignature: "sig-abc" }],
      [{ text: "done" }],
    ]);
    await run(new GeminiProvider("test-key"));

    const modelTurn = capturedBodies[1].contents[1];
    const callPart = modelTurn.parts.find((p: any) => p.functionCall);
    assert.equal(callPart.thoughtSignature, "sig-abc", "raw wire part fields must survive the resend");
  });

  it("drops lone empty-text parts but keeps empty text riding with a signature", async () => {
    scriptHops([
      [
        { text: "" },
        { text: "", thoughtSignature: "sig-keep" },
        { functionCall: { name: "get_goals", args: {} } },
      ],
      [{ text: "done" }],
    ]);
    await run(new GeminiProvider("test-key"));

    const parts = capturedBodies[1].contents[1].parts;
    assert.equal(
      parts.filter((p: any) => p.text === "" && !p.thoughtSignature).length,
      0,
      "lone empty text dropped",
    );
    assert.ok(parts.some((p: any) => p.thoughtSignature === "sig-keep"), "signed empty-text part kept");
  });

  it("finishes without a second hop when no tool is called", async () => {
    scriptHops([[{ text: "plain answer" }]]);
    const events = await run(new GeminiProvider("test-key"));

    assert.equal(capturedBodies.length, 1);
    assert.ok(events.some((e) => e.kind === "text" && e.text === "plain answer"));
    assert.ok(events.some((e) => e.kind === "done" && e.reason === "complete"));
  });
});

// Gemini's default harm filters can block legitimate crisis-coaching replies;
// the deterministic crisis safety net (988) is the enforcement layer, so the
// provider must relax every generation path to BLOCK_ONLY_HIGH. These tests
// pin the safetySettings the API actually receives on the wire.
const EXPECTED_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
];

const USER_MESSAGES = [{ role: "user" as const, content: "hi" }];

describe("GeminiProvider safetySettings on every generation path", () => {
  beforeEach(() => {
    capturedBodies = [];
  });

  it("sends BLOCK_ONLY_HIGH safetySettings on generateResponse", async () => {
    scriptJson();
    await new GeminiProvider("test-key").generateResponse("system", USER_MESSAGES);

    assert.equal(capturedBodies.length, 1);
    assert.deepEqual(capturedBodies[0].safetySettings, EXPECTED_SAFETY_SETTINGS);
  });

  it("sends BLOCK_ONLY_HIGH safetySettings on streamResponse", async () => {
    scriptHops([[{ text: "hello" }]]);
    await drain(new GeminiProvider("test-key").streamResponse("system", USER_MESSAGES));

    assert.equal(capturedBodies.length, 1);
    assert.deepEqual(capturedBodies[0].safetySettings, EXPECTED_SAFETY_SETTINGS);
  });

  it("sends BLOCK_ONLY_HIGH safetySettings on generateStructuredResponse", async () => {
    scriptJson();
    await new GeminiProvider("test-key").generateStructuredResponse("system", USER_MESSAGES);

    assert.equal(capturedBodies.length, 1);
    assert.deepEqual(capturedBodies[0].safetySettings, EXPECTED_SAFETY_SETTINGS);
  });

  it("sends BLOCK_ONLY_HIGH safetySettings on every streamWithTools hop", async () => {
    scriptHops([
      [{ functionCall: { name: "get_goals", args: {} } }],
      [{ text: "done" }],
    ]);
    await run(new GeminiProvider("test-key"));

    assert.equal(capturedBodies.length, 2, "expected two hops");
    for (const body of capturedBodies) {
      assert.deepEqual(body.safetySettings, EXPECTED_SAFETY_SETTINGS);
    }
  });
});

// Transient failures (429/5xx/network) on the cloud chat turn are retried,
// but ONLY before the first streamed token reaches the client — retrying an
// established stream would duplicate partial output. These tests pin the
// retry boundary at the wire level via fetch-call counts.
describe("GeminiProvider transient-failure retry", () => {
  beforeEach(() => {
    capturedBodies = [];
  });

  it("retries generateResponse on a 500 and succeeds on the second call", async () => {
    scriptSequence([() => httpError(500), () => jsonResponse("recovered")]);
    const text = await new GeminiProvider("test-key").generateResponse("system", USER_MESSAGES);

    assert.equal(text, "recovered");
    assert.equal(capturedBodies.length, 2, "500 then success = exactly two fetch calls");
  });

  it("does not retry generateResponse on a 400", async () => {
    scriptSequence([() => httpError(400)]);
    await assert.rejects(
      () => new GeminiProvider("test-key").generateResponse("system", USER_MESSAGES),
      /400/,
    );

    assert.equal(capturedBodies.length, 1, "client errors must not be retried");
  });

  it("retries streamResponse establishment on a 503", async () => {
    scriptSequence([() => httpError(503), () => sseResponse([{ text: "hello" }])]);
    const chunks: string[] = [];
    for await (const chunk of new GeminiProvider("test-key").streamResponse(
      "system",
      USER_MESSAGES,
    )) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, ["hello"]);
    assert.equal(capturedBodies.length, 2, "failed establishment retried once");
  });

  it("propagates a mid-stream failure after the first chunk with no second attempt", async () => {
    scriptSequence([() => sseBodyErrorAfter([{ text: "partial" }])]);
    const chunks: string[] = [];
    await assert.rejects(async () => {
      for await (const chunk of new GeminiProvider("test-key").streamResponse(
        "system",
        USER_MESSAGES,
      )) {
        chunks.push(chunk);
      }
    }, /reading from the stream/i);

    assert.deepEqual(chunks, ["partial"], "the first chunk reached the client before the failure");
    assert.equal(capturedBodies.length, 1, "no retry once streaming has started");
  });

  it("retries streamWithTools hop establishment on a 500", async () => {
    scriptSequence([() => httpError(500), () => sseResponse([{ text: "done" }])]);
    const events = await run(new GeminiProvider("test-key"));

    assert.ok(events.some((e) => e.kind === "text" && e.text === "done"));
    assert.ok(events.some((e) => e.kind === "done" && e.reason === "complete"));
    assert.equal(capturedBodies.length, 2, "failed establishment retried once");
  });
});
