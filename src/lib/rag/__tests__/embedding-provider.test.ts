import { describe, it } from "node:test";
import assert from "node:assert";
import { GeminiEmbeddingProvider } from "../embedding-provider";

describe("GeminiEmbeddingProvider", () => {
  it("throws on empty API key", () => {
    assert.throws(
      () => new GeminiEmbeddingProvider(""),
      { message: "GeminiEmbeddingProvider: apiKey must not be empty" },
    );
    assert.throws(
      () => new GeminiEmbeddingProvider("   "),
      { message: "GeminiEmbeddingProvider: apiKey must not be empty" },
    );
  });

  it("returns empty array for empty input", async () => {
    const provider = new GeminiEmbeddingProvider("test-key");
    const result = await provider.embed([]);
    assert.deepStrictEqual(result, []);
  });

  it("exposes correct dimensions, name, and version", () => {
    const provider = new GeminiEmbeddingProvider("test-key");
    assert.strictEqual(provider.dimensions, 768);
    assert.strictEqual(provider.name, "text-embedding-004");
    assert.strictEqual(provider.version, "v1");
  });
});
