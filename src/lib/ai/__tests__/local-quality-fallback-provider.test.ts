import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalQualityFallbackProvider } from "../local-quality-fallback-provider";
import type { AIProvider } from "../types";

function provider(stream: () => AsyncGenerator<string>): AIProvider {
  return {
    name: "ollama",
    async generateResponse() {
      return "response";
    },
    streamResponse: stream,
    async generateStructuredResponse() {
      return "{}";
    },
  };
}

describe("LocalQualityFallbackProvider", () => {
  it("discards partial quality output and emits only completed default-Gemma output", async () => {
    const primary = provider(async function* () {
      yield "quality partial";
      throw new Error("quality model became unhealthy");
    });
    const fallback = provider(async function* () {
      yield "default ";
      yield "Gemma";
    });
    const routed = new LocalQualityFallbackProvider(
      primary,
      fallback,
      "gemma4:26b",
      "gemma4:12b",
      "complex_structured",
    );

    const observed: string[] = [];
    for await (const chunk of routed.streamResponse("system", [
      { role: "user", content: "synthetic request" },
    ])) {
      observed.push(chunk);
    }

    assert.deepEqual(observed, ["default ", "Gemma"]);
    assert.equal(routed.localRouting.fallbackModel, "gemma4:12b");
    assert.equal(routed.localRouting.buffersBeforeOutput, true);
  });

  it("rejects any non-Gemma fallback model", () => {
    const fake = provider(async function* () {
      yield "text";
    });
    assert.throws(
      () =>
        new LocalQualityFallbackProvider(
          fake,
          fake,
          "gemma4:26b",
          "qwen3.5:9b",
          "complex_structured",
        ),
      /fallback model must be a Gemma model/i,
    );
  });
});
