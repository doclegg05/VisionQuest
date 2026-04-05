import { describe, it } from "node:test";
import assert from "node:assert";
import { scorePageQuality, extractFromBuffer } from "../extract";

describe("scorePageQuality", () => {
  it("returns > 0.8 for clean text", () => {
    const text =
      "This is a normal paragraph of text that contains useful information about workforce development programs and certification tracking.";
    const score = scorePageQuality(text);
    assert.ok(score > 0.8, `Expected score > 0.8, got ${score}`);
  });

  it("returns < 0.3 for mostly whitespace", () => {
    const text =
      "  " + " ".repeat(200) + "\n".repeat(50) + " ".repeat(200) + "x";
    const score = scorePageQuality(text);
    assert.ok(score < 0.3, `Expected score < 0.3, got ${score}`);
  });

  it("returns < 0.3 for text with many replacement characters", () => {
    const text = "\uFFFD".repeat(100) + "abc";
    const score = scorePageQuality(text);
    assert.ok(score < 0.3, `Expected score < 0.3, got ${score}`);
  });

  it("returns 0 for empty string", () => {
    assert.strictEqual(scorePageQuality(""), 0);
  });
});

describe("extractFromBuffer", () => {
  it("returns single page with correct content for text/markdown", async () => {
    const content = "# Hello World\n\nThis is a markdown document.";
    const buffer = Buffer.from(content, "utf-8");
    const result = await extractFromBuffer(buffer, "text/markdown", "test-doc");

    assert.strictEqual(result.title, "test-doc");
    assert.strictEqual(result.mimeType, "text/markdown");
    assert.strictEqual(result.pages.length, 1);
    assert.strictEqual(result.pages[0].pageNumber, 1);
    assert.strictEqual(result.pages[0].text, content);
    assert.strictEqual(result.pages[0].qualityScore, 1.0);
    assert.strictEqual(result.pages[0].ocrUsed, false);
  });

  it("returns single page with correct content for text/plain", async () => {
    const content = "Just some plain text content.";
    const buffer = Buffer.from(content, "utf-8");
    const result = await extractFromBuffer(buffer, "text/plain", "plain-doc");

    assert.strictEqual(result.pages.length, 1);
    assert.strictEqual(result.pages[0].text, content);
  });

  it("throws for unsupported mimeType", async () => {
    const buffer = Buffer.from("data", "utf-8");
    await assert.rejects(
      () => extractFromBuffer(buffer, "image/png", "bad-doc"),
      { message: "Unsupported mimeType for extraction: image/png" },
    );
  });
});
