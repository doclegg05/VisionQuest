import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OllamaProvider } from "../ollama-provider";

const TIMEOUT_MS = 300_000;
const messages = [{ role: "user" as const, content: "Hello" }];
const encoder = new TextEncoder();
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function provider(native: boolean) {
  return new OllamaProvider("http://unused.invalid", "test-model", {
    authMode: "none",
    ...(native ? { keepAlive: "5m" } : { apiStyle: "openai" as const }),
  });
}

function payload(native: boolean) {
  return JSON.stringify(native
    ? { message: { content: "Hello" } }
    : { choices: [{ message: { content: "Hello" } }] });
}

describe("Ollama non-streaming body deadline", () => {
  for (const native of [false, true]) {
    for (const method of ["generateResponse", "generateStructuredResponse"] as const) {
      const label = `${native ? "native" : "OpenAI"}, ${method}`;
      for (const partial of [false, true]) {
        it(`rejects a ${partial ? "partial" : "silent"} stalled body (${label})`, async (t) => {
          t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1 });
          const cancel = t.mock.fn();
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              if (partial) controller.enqueue(encoder.encode('{"message":'));
            },
            cancel,
          });
          let signal!: AbortSignal;
          const fetch = t.mock.method(globalThis, "fetch", async (...[_url, init]: Parameters<typeof globalThis.fetch>) => {
            signal = init!.signal!;
            return new Response(body);
          });
          const onUsage = t.mock.fn();
          const pending = provider(native)[method]("system", messages, onUsage);
          const rejected = assert.rejects(pending, /Local AI request timed out after 300 seconds/);
          await flush();
          assert.equal(body.locked, true);
          t.mock.timers.tick(TIMEOUT_MS);
          await rejected;
          assert.equal(signal.aborted, true);
          assert.equal(cancel.mock.callCount(), 1);
          assert.equal(body.locked, false);
          assert.equal(fetch.mock.callCount(), 1);
          assert.equal(onUsage.mock.callCount(), 0);
        });
      }

      it(`clears the deadline and unlocks a successful body (${label})`, async (t) => {
        t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1 });
        const body = new Response(payload(native)).body!;
        let signal!: AbortSignal;
        t.mock.method(globalThis, "fetch", async (...[_url, init]: Parameters<typeof globalThis.fetch>) => {
          signal = init!.signal!;
          return new Response(body);
        });
        assert.equal(await provider(native)[method]("system", messages), "Hello");
        assert.equal(body.locked, false);
        t.mock.timers.tick(TIMEOUT_MS * 2);
        assert.equal(signal.aborted, false, "completed requests must not retain their abort timer");
      });

      it(`clears the deadline and unlocks invalid JSON (${label})`, async (t) => {
        t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1 });
        const body = new Response("not json").body!;
        let signal!: AbortSignal;
        t.mock.method(globalThis, "fetch", async (...[_url, init]: Parameters<typeof globalThis.fetch>) => {
          signal = init!.signal!;
          return new Response(body);
        });
        await assert.rejects(provider(native)[method]("system", messages), SyntaxError);
        assert.equal(body.locked, false);
        t.mock.timers.tick(TIMEOUT_MS * 2);
        assert.equal(signal.aborted, false);
      });
    }
  }

  it("does not restart the deadline when delayed headers arrive", async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1 });
    let headers!: (response: Response) => void;
    const cancel = t.mock.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { headers = resolve; }));
    const pending = provider(false).generateResponse("system", messages);
    const rejected = assert.rejects(pending, /timed out/);
    t.mock.timers.tick(TIMEOUT_MS - 1);
    headers(new Response(body));
    await flush();
    assert.equal(body.locked, true);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(cancel.mock.callCount(), 1);
    assert.equal(body.locked, false);
  });

  it("does not extend the total deadline when body bytes keep arriving", async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1 });
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
    t.mock.method(globalThis, "fetch", async () => new Response(body));
    const pending = provider(false).generateResponse("system", messages);
    const rejected = assert.rejects(pending, /timed out/);
    await flush();
    t.mock.timers.tick(TIMEOUT_MS - 1);
    source.enqueue(encoder.encode('{"choices":'));
    await flush();
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(body.locked, false);
  });

  it("rejects promptly even if the upstream cancel hook never settles", async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1 });
    const body = new ReadableStream<Uint8Array>({ cancel: () => new Promise<void>(() => undefined) });
    t.mock.method(globalThis, "fetch", async () => new Response(body));
    const pending = provider(false).generateResponse("system", messages);
    const rejected = assert.rejects(pending, /timed out/);
    await flush();
    t.mock.timers.tick(TIMEOUT_MS);
    await rejected;
    assert.equal(body.locked, false);
  });

  it("clears the timer and releases the reader when the body errors", async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1 });
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
    let signal!: AbortSignal;
    t.mock.method(globalThis, "fetch", async (...[_url, init]: Parameters<typeof globalThis.fetch>) => {
      signal = init!.signal!;
      return new Response(body);
    });
    const pending = provider(false).generateResponse("system", messages);
    const rejected = assert.rejects(pending, /body failed/);
    await flush();
    source.error(new Error("body failed"));
    await rejected;
    assert.equal(body.locked, false);
    t.mock.timers.tick(TIMEOUT_MS * 2);
    assert.equal(signal.aborted, false);
  });

  it("clears timers on fetch rejection and HTTP errors without reading error bodies", async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1 });
    const signals: AbortSignal[] = [];
    const cancel = t.mock.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    t.mock.method(globalThis, "fetch", async (...[_url, init]: Parameters<typeof globalThis.fetch>) => {
      signals.push(init!.signal!);
      if (signals.length === 1) throw new Error("fetch failed");
      return new Response(body, { status: 401 });
    });
    const p = provider(false);
    await assert.rejects(p.generateResponse("system", messages), /fetch failed/);
    await assert.rejects(p.generateResponse("system", messages), /401/);
    assert.equal(cancel.mock.callCount(), 1);
    t.mock.timers.tick(TIMEOUT_MS * 2);
    assert.ok(signals.every((signal) => !signal.aborted));
  });

  it("disposes of a response arriving after the header deadline", async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1 });
    let headers!: (response: Response) => void;
    const cancel = t.mock.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { headers = resolve; }));
    const pending = provider(false).generateResponse("system", messages);
    const rejected = assert.rejects(pending, /timed out/);
    t.mock.timers.tick(TIMEOUT_MS);
    await rejected;
    headers(new Response(body));
    await flush();
    assert.equal(cancel.mock.callCount(), 1);
    assert.equal(body.locked, false);
  });
});
