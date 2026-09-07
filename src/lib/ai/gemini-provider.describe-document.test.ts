/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";

/**
 * `describeDocument` — the one multimodal method on the AIProvider
 * interface, implemented by GeminiProvider only. Pinned at the wire level
 * (global.fetch stub, the gemini-provider.test.ts idiom): the bytes go
 * inline in a generateContent request, JSON mode is honoured, usage is
 * reported, and the local provider deliberately has no such method.
 */

process.env.LOG_LEVEL = "error";

mock.module("@/lib/gemini", {
  namedExports: { GEMINI_MODEL: "gemini-test" },
});

import type { AIProvider } from "./types";

let GeminiProvider: typeof import("./gemini-provider").GeminiProvider;
let OllamaProvider: typeof import("./ollama-provider").OllamaProvider;

before(async () => {
  ({ GeminiProvider } = await import("./gemini-provider"));
  ({ OllamaProvider } = await import("./ollama-provider"));
});

const originalFetch = global.fetch;
after(() => {
  global.fetch = originalFetch;
});

let captured: { url: string; body: any }[] = [];

function jsonResponse(text: string): Response {
  const body = {
    candidates: [{ index: 0, content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12, totalTokenCount: 52 },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  captured = [];
  global.fetch = (async (url: any, init: any) => {
    captured.push({ url: String(url), body: JSON.parse(init.body) });
    return jsonResponse("A signed attendance contract.");
  }) as any;
});

describe("GeminiProvider.describeDocument", () => {
  it("sends the bytes inline with the prompt to :generateContent and returns the text", async () => {
    const provider = new GeminiProvider("test-key");
    assert.equal(typeof provider.describeDocument, "function");

    const bytes = Buffer.from("%PDF-1.4 pretend");
    const text = await provider.describeDocument!(bytes, "application/pdf", "Describe this.");

    assert.equal(text, "A signed attendance contract.");
    assert.equal(captured.length, 1);
    assert.match(captured[0].url, /models\/gemini-test:generateContent/);
    const parts = captured[0].body.contents[0].parts;
    assert.deepEqual(parts[0], { inlineData: { mimeType: "application/pdf", data: bytes.toString("base64") } });
    assert.deepEqual(parts[1], { text: "Describe this." });
    assert.equal(captured[0].body.generationConfig?.responseMimeType, undefined);
  });

  it("honours JSON mode and a response schema, and reports provider usage", async () => {
    const provider = new GeminiProvider("test-key");
    const usages: unknown[] = [];
    const schema = { type: "object", properties: { kind: { type: "string" } }, required: ["kind"] };

    await provider.describeDocument!(Buffer.from("x"), "image/png", "Classify.", {
      responseFormat: "json",
      responseSchema: schema,
      onUsage: (usage) => usages.push(usage),
    });

    assert.equal(captured[0].body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(captured[0].body.generationConfig.responseSchema, schema);
    assert.deepEqual(usages, [{ inputTokens: 40, outputTokens: 12, totalTokens: 52, source: "provider" }]);
  });

  it("is absent on the local provider, so a file-gist call there cannot reach a document model", () => {
    const local: AIProvider = new OllamaProvider("http://localhost:11434", "gemma4");
    assert.equal(local.describeDocument, undefined);
  });
});
