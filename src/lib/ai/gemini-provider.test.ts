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
