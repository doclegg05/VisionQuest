import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";

// E7 (3): a Stop or a dropped connection aborts the model call. The caller's
// AbortSignal reaches the provider's fetch, the request is cancelled at once,
// and a cancelled call is never retried (both providers retry a failure that
// happens before the first token, and an abort reads like one).

process.env.LOG_LEVEL = "error";

mock.module("@/lib/gemini", { namedExports: { GEMINI_MODEL: "gemini-test" } });

let OllamaProvider: typeof import("../ollama-provider").OllamaProvider;
let GeminiProvider: typeof import("../gemini-provider").GeminiProvider;

before(async () => {
  ({ OllamaProvider } = await import("../ollama-provider"));
  ({ GeminiProvider } = await import("../gemini-provider"));
});

const messages = [{ role: "user" as const, content: "Hello" }];
const tools = [{ name: "lookup", description: "Lookup", parameters: { type: "object" as const, properties: {} } }];
const noTool = async () => ({ status: "success" as const, summary: "ok", response: {} });
const BOUND = { timeout: 5_000 };

interface FetchRecord {
  calls: number;
  signals: AbortSignal[];
}

/** A fetch that never answers until its signal aborts, as a slow model host would. */
function hangingFetch(): FetchRecord {
  const record: FetchRecord = { calls: 0, signals: [] };
  mock.method(globalThis, "fetch", (_url: unknown, init?: RequestInit) => {
    record.calls += 1;
    const signal = init?.signal;
    if (signal) record.signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      if (!signal) return;
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  return record;
}

/** Drains `stream` and aborts `controller` once the fetch is in flight. Returns the thrown error. */
async function abortMidCall(
  stream: AsyncGenerator<unknown>,
  controller: AbortController,
  record: FetchRecord,
): Promise<unknown> {
  const drained = (async () => {
    for await (const _ of stream) {
      /* nothing arrives */
    }
  })();
  for (let i = 0; i < 100 && record.calls === 0; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(record.calls, 1, "the model call started");
  controller.abort();
  return drained.then(
    () => assert.fail("the stream ended without the abort"),
    (error: unknown) => error,
  );
}

function ollama(native: boolean) {
  return new OllamaProvider("http://unused.invalid", "test-model", {
    authMode: "none",
    ...(native ? {} : { apiStyle: "openai" as const }),
  });
}

// Without the fix the providers ignore the signal and wait out their own
// 300 s deadlines, so each case has a short bound of its own.
describe("a client abort cancels the provider call (E7)", () => {
  afterEach(() => mock.restoreAll());

  for (const native of [false, true]) {
    const surface = native ? "native" : "OpenAI";

    it(`Ollama streamResponse (${surface}): the abort reaches fetch and is not retried`, BOUND, async () => {
      const record = hangingFetch();
      const controller = new AbortController();
      await abortMidCall(
        ollama(native).streamResponse("system", messages, undefined, { signal: controller.signal }),
        controller,
        record,
      );
      for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 5));
      assert.equal(record.calls, 1, "a cancelled call is never retried");
      assert.ok(record.signals[0]?.aborted, "the request's own signal aborted");
    });

    it(`Ollama streamWithTools (${surface}): the abort reaches fetch and is not retried`, BOUND, async () => {
      const record = hangingFetch();
      const controller = new AbortController();
      await abortMidCall(
        ollama(native).streamWithTools("system", messages, tools, noTool, { signal: controller.signal }),
        controller,
        record,
      );
      for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 5));
      assert.equal(record.calls, 1, "a cancelled call is never retried");
      assert.ok(record.signals[0]?.aborted, "the request's own signal aborted");
    });
  }

  it("Ollama: a signal already aborted sends nothing", BOUND, async () => {
    const record = hangingFetch();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(async () => {
      for await (const _ of ollama(true).streamResponse("system", messages, undefined, { signal: controller.signal })) {
        /* nothing */
      }
    });
    assert.equal(record.calls, 0);
  });

  it("Gemini streamResponse: the abort reaches fetch and is not retried", BOUND, async () => {
    const record = hangingFetch();
    const controller = new AbortController();
    await abortMidCall(
      new GeminiProvider("test-key").streamResponse("system", messages, undefined, { signal: controller.signal }),
      controller,
      record,
    );
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(record.calls, 1, "a cancelled call is never retried");
    assert.ok(record.signals[0]?.aborted, "the request's own signal aborted");
  });

  it("Gemini streamWithTools: the abort reaches fetch and is not retried", BOUND, async () => {
    const record = hangingFetch();
    const controller = new AbortController();
    await abortMidCall(
      new GeminiProvider("test-key").streamWithTools("system", messages, tools, noTool, { signal: controller.signal }),
      controller,
      record,
    );
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(record.calls, 1, "a cancelled call is never retried");
    assert.ok(record.signals[0]?.aborted, "the request's own signal aborted");
  });
});
