import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { OllamaProvider } from "../ollama-provider";

const messages = [{ role: "user" as const, content: "Hello" }];
const tools = [{ name: "lookup", description: "Lookup", parameters: { type: "object" as const, properties: {} } }];
const encoder = new TextEncoder();

function openStream(payload: string, cancel = mock.fn(() => undefined)) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(payload)); },
    cancel,
  });
  return { body, cancel };
}

function provider(native = false) {
  return new OllamaProvider("http://unused.invalid", "test-model", {
    authMode: "none", ...(native ? { keepAlive: "5m" } : { apiStyle: "openai" as const }),
  });
}

function stream(p: OllamaProvider, withTools: boolean) {
  return withTools
    ? p.streamWithTools("system", messages, tools, async () => ({ status: "success", summary: "ok", response: {} }))
    : p.streamResponse("system", messages);
}

function textFrame(native: boolean) {
  return native
    ? JSON.stringify({ message: { content: "Hello" }, done: false }) + "\n"
    : `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`;
}

describe("Ollama stream resource ownership", () => {
  beforeEach(() => {
    mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  });
  afterEach(() => mock.restoreAll());

  for (const native of [false, true]) {
    for (const withTools of [false, true]) {
      const label = `${native ? "native" : "OpenAI"}, ${withTools ? "tools" : "plain"}`;
      it(`cancels and unlocks after consumer break (${label})`, async () => {
        const upstream = openStream(textFrame(native));
        mock.method(globalThis, "fetch", async () => new Response(upstream.body));
        for await (const _ of stream(provider(native), withTools)) break;
        assert.equal(upstream.cancel.mock.callCount(), 1);
        assert.equal(upstream.body.locked, false);
      });

      it(`cancels and unlocks at protocol completion (${label})`, async () => {
        const done = native ? '{"done":true}\n' : "data: [DONE]\n\n";
        const upstream = openStream(textFrame(native) + done);
        mock.method(globalThis, "fetch", async () => new Response(upstream.body));
        for await (const _ of stream(provider(native), withTools)) { /* drain */ }
        assert.equal(upstream.cancel.mock.callCount(), 1);
        assert.equal(upstream.body.locked, false);
      });

      it(`cleans up on payload error without retrying visible output (${label})`, async () => {
        const error = native ? '{"error":"bad payload"}\n' : 'data: {"error":"bad payload"}\n\n';
        const upstream = openStream(textFrame(native) + error);
        const fetch = mock.method(globalThis, "fetch", async () => new Response(upstream.body));
        await assert.rejects(async () => {
          for await (const _ of stream(provider(native), withTools)) { /* drain */ }
        }, /bad payload/);
        assert.equal(fetch.mock.callCount(), 1);
        assert.equal(upstream.cancel.mock.callCount(), 1);
        assert.equal(upstream.body.locked, false);
      });
    }
  }

  it("does not wait for an upstream cancellation hook to settle", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encoder.encode(textFrame(false))); },
      cancel() { return new Promise<void>(() => undefined); },
    });
    mock.method(globalThis, "fetch", async () => new Response(body));
    for await (const _ of provider().streamResponse("system", messages)) break;
    assert.equal(body.locked, false);
  });

  it("rejects an expired deadline even when upstream cancellation never settles", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1 });
    const cancel = mock.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encoder.encode(textFrame(false))); },
      cancel,
    });
    mock.method(globalThis, "fetch", async () => new Response(body));
    const iterator = provider().streamResponse("system", messages);
    assert.equal((await iterator.next()).value, "Hello");
    t.mock.timers.setTime(60_002);
    await assert.rejects(iterator.next(), /timed out/);
    assert.equal(cancel.mock.callCount(), 1);
    assert.equal(body.locked, false);
  });

  it("discards a failed OpenAI response before native fallback", async () => {
    const failed = openStream("not found");
    const fetch = mock.method(globalThis, "fetch", async (url) => {
      if (String(url).endsWith("/v1/chat/completions")) return new Response(failed.body, { status: 404 });
      assert.equal(failed.cancel.mock.callCount(), 1);
      return Response.json({ message: { content: "Hello" } });
    });
    const p = new OllamaProvider("http://unused.invalid", "test-model", { authMode: "none" });
    assert.equal(await p.generateResponse("system", messages), "Hello");
    assert.equal(fetch.mock.callCount(), 2);
  });

  it("cancels a non-retryable HTTP error body", async () => {
    const failed = openStream("unauthorized");
    mock.method(globalThis, "fetch", async () => new Response(failed.body, { status: 401 }));
    await assert.rejects(provider().generateStructuredResponse("system", messages), /401/);
    assert.equal(failed.cancel.mock.callCount(), 1);
  });
});
