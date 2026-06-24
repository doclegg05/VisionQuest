import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkText } from "./chunking";

describe("chunkText", () => {
  it("returns [] for blank input", () => {
    assert.deepEqual(chunkText(""), []);
    assert.deepEqual(chunkText("   \n\n  "), []);
  });

  it("returns a single chunk for short text", () => {
    const chunks = chunkText("A short paragraph about the dress code.");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], "A short paragraph about the dress code.");
  });

  it("never produces a chunk longer than maxChars", () => {
    const text = Array.from({ length: 60 }, (_, i) =>
      `Paragraph ${i} explains one orientation requirement in plain language for students.`,
    ).join("\n\n");
    const chunks = chunkText(text, { maxChars: 500, overlapChars: 50 });
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 500, `chunk of ${chunk.length} chars exceeds 500`);
    }
  });

  it("splits on paragraph boundaries when possible", () => {
    const para1 = "First paragraph. ".repeat(10).trim();
    const para2 = "Second paragraph. ".repeat(10).trim();
    const chunks = chunkText(`${para1}\n\n${para2}`, { maxChars: 200, overlapChars: 0 });
    assert.ok(chunks.length >= 2);
    assert.ok(chunks[0].startsWith("First paragraph."));
  });

  it("hard-splits a single run of text with no boundaries", () => {
    const text = "x".repeat(5000);
    const chunks = chunkText(text, { maxChars: 2048, overlapChars: 200 });
    assert.ok(chunks.length >= 3);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 2048);
    }
    // All content covered
    assert.ok(chunks.join("").length >= 5000);
  });

  it("carries overlap between consecutive chunks", () => {
    const sentences = Array.from({ length: 40 }, (_, i) =>
      `Sentence number ${i} talks about certification steps.`,
    ).join(" ");
    const chunks = chunkText(sentences, { maxChars: 400, overlapChars: 100 });
    assert.ok(chunks.length > 1);
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1].slice(-60);
      // The start of each chunk should repeat material from the previous one.
      assert.ok(
        chunks[i].includes(prevTail.slice(-30)) || chunks[i - 1].endsWith(chunks[i].slice(0, 30)),
        `chunk ${i} does not overlap with chunk ${i - 1}`,
      );
    }
  });

  it("trims whitespace from chunks and drops empty fragments", () => {
    const chunks = chunkText("para one\n\n\n\n   \n\npara two", { maxChars: 50, overlapChars: 0 });
    for (const chunk of chunks) {
      assert.equal(chunk, chunk.trim());
      assert.ok(chunk.length > 0);
    }
  });
});
