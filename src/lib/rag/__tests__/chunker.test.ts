import { describe, it } from "node:test";
import assert from "node:assert";
import {
  detectContentType,
  estimateTokens,
  buildBreadcrumb,
  stripBoilerplate,
  chunkProse,
  chunkStructured,
  chunkLinks,
  chunkDocument,
} from "../chunker";
import type { ExtractedPage } from "../types";

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("returns ~25 for 100 characters", () => {
    const text = "a".repeat(100);
    assert.strictEqual(estimateTokens(text), 25);
  });

  it("returns 0 for empty string", () => {
    assert.strictEqual(estimateTokens(""), 0);
  });

  it("rounds up fractional values", () => {
    // 13 chars / 4 = 3.25 → 4
    assert.strictEqual(estimateTokens("Hello, world!"), 4);
  });
});

// ---------------------------------------------------------------------------
// buildBreadcrumb
// ---------------------------------------------------------------------------

describe("buildBreadcrumb", () => {
  it("returns title only when no section heading", () => {
    assert.strictEqual(buildBreadcrumb("My Document", null), "My Document");
  });

  it("returns title > heading when section heading is provided", () => {
    assert.strictEqual(
      buildBreadcrumb("My Document", "Chapter 1"),
      "My Document > Chapter 1",
    );
  });

  it("collapses extra whitespace in title and heading", () => {
    assert.strictEqual(
      buildBreadcrumb("  My   Document  ", "  Chapter   1  "),
      "My Document > Chapter 1",
    );
  });
});

// ---------------------------------------------------------------------------
// detectContentType
// ---------------------------------------------------------------------------

describe("detectContentType", () => {
  it('returns "structured" for text with markdown headings', () => {
    const text = [
      "# Section One",
      "Some content here.",
      "## Section Two",
      "More content.",
      "## Section Three",
      "Even more content.",
    ].join("\n");
    assert.strictEqual(detectContentType(text), "structured");
  });

  it('returns "structured" for text with numbered lists', () => {
    const text = [
      "Instructions:",
      "1. First step",
      "2. Second step",
      "3. Third step",
      "4. Fourth step",
    ].join("\n");
    assert.strictEqual(detectContentType(text), "structured");
  });

  it('returns "structured" for form field patterns', () => {
    const text = "Name: ______\nAddress: ______\nPhone: ______";
    assert.strictEqual(detectContentType(text), "structured");
  });

  it('returns "structured" for checkbox patterns', () => {
    const text = "- [x] Task one done\n- [ ] Task two pending";
    assert.strictEqual(detectContentType(text), "structured");
  });

  it('returns "prose" for plain paragraph text', () => {
    const text =
      "This is a normal paragraph of text without any special formatting. " +
      "It just contains regular sentences that flow from one to the next. " +
      "There are no headings, lists, or links in this text.";
    assert.strictEqual(detectContentType(text), "prose");
  });

  it('returns "links" for text with multiple URLs', () => {
    const text = [
      "Check out https://example.com for more info.",
      "Also visit https://docs.example.com/guide for the guide.",
      "And https://api.example.com/reference for API docs.",
    ].join("\n");
    assert.strictEqual(detectContentType(text), "links");
  });

  it('returns "links" when URLs outnumber other patterns', () => {
    const text = [
      "Resources:",
      "- Main site: https://example.com",
      "- Docs: https://docs.example.com",
      "- API: https://api.example.com",
    ].join("\n");
    assert.strictEqual(detectContentType(text), "links");
  });
});

// ---------------------------------------------------------------------------
// stripBoilerplate
// ---------------------------------------------------------------------------

describe("stripBoilerplate", () => {
  it("removes text that repeats across 3+ pages", () => {
    const header = "ACME Corp — Confidential Document Header";
    const footer = "Copyright 2026 ACME Corp — All Rights Reserved";
    // Middle content must be long enough that the 100-char header/footer
    // windows do not overlap (total text > 200 chars).
    const filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(3);
    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: `${header}\n${filler}Page one unique content.\n${footer}`,
        qualityScore: 1,
        ocrUsed: false,
      },
      {
        pageNumber: 2,
        text: `${header}\n${filler}Page two unique content.\n${footer}`,
        qualityScore: 1,
        ocrUsed: false,
      },
      {
        pageNumber: 3,
        text: `${header}\n${filler}Page three unique content.\n${footer}`,
        qualityScore: 1,
        ocrUsed: false,
      },
    ];

    const result = stripBoilerplate(pages);

    for (const page of result) {
      assert.ok(
        !page.text.includes(header),
        `Page ${page.pageNumber} should not contain header`,
      );
      assert.ok(
        !page.text.includes(footer),
        `Page ${page.pageNumber} should not contain footer`,
      );
      assert.ok(
        page.text.includes("content"),
        `Page ${page.pageNumber} should retain its content`,
      );
    }
  });

  it("does not strip text that appears on fewer than 3 pages", () => {
    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: "Unique header\nContent one.",
        qualityScore: 1,
        ocrUsed: false,
      },
      {
        pageNumber: 2,
        text: "Unique header\nContent two.",
        qualityScore: 1,
        ocrUsed: false,
      },
    ];

    const result = stripBoilerplate(pages);
    assert.strictEqual(result[0].text, pages[0].text);
    assert.strictEqual(result[1].text, pages[1].text);
  });

  it("returns pages unchanged when fewer than 3 pages", () => {
    const pages: ExtractedPage[] = [
      { pageNumber: 1, text: "Same text", qualityScore: 1, ocrUsed: false },
      { pageNumber: 2, text: "Same text", qualityScore: 1, ocrUsed: false },
    ];

    const result = stripBoilerplate(pages);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].text, "Same text");
  });
});

// ---------------------------------------------------------------------------
// chunkProse
// ---------------------------------------------------------------------------

describe("chunkProse", () => {
  it("produces 3-4 chunks for ~1000-token text", () => {
    // Each sentence ~50 tokens (200 chars). 20 sentences = ~1000 tokens.
    const sentences: string[] = [];
    for (let i = 0; i < 20; i++) {
      sentences.push(
        `This is sentence number ${i + 1} which contains enough words to make it approximately fifty tokens in length when estimated using the character-based method.`,
      );
    }
    const text = sentences.join(" ");

    const chunks = chunkProse(text, "Test Doc");
    assert.ok(
      chunks.length >= 3 && chunks.length <= 5,
      `Expected 3-5 chunks, got ${chunks.length}`,
    );

    // All chunks except the last should be in the 250-400 range.
    // The last chunk may be smaller due to overlap and remaining text.
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      assert.strictEqual(chunk.chunkType, "prose");
      if (i < chunks.length - 1) {
        assert.ok(
          chunk.tokenCount >= 100,
          `Non-final chunk too small: ${chunk.tokenCount} tokens`,
        );
      }
      assert.ok(
        chunk.tokenCount <= 450,
        `Chunk too large: ${chunk.tokenCount} tokens`,
      );
    }
  });

  it("returns empty array for empty text", () => {
    const chunks = chunkProse("", "Test Doc");
    assert.strictEqual(chunks.length, 0);
  });

  it("returns single chunk for short text", () => {
    const chunks = chunkProse("A short sentence.", "Test Doc");
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].content, "A short sentence.");
  });
});

// ---------------------------------------------------------------------------
// chunkStructured
// ---------------------------------------------------------------------------

describe("chunkStructured", () => {
  it("splits by headings", () => {
    const text = [
      "# Introduction",
      "Intro content here.",
      "## Methods",
      "Methods content here.",
      "## Results",
      "Results content here.",
    ].join("\n");

    const chunks = chunkStructured(text, "Paper");
    assert.ok(chunks.length >= 3, `Expected >= 3 chunks, got ${chunks.length}`);
    assert.strictEqual(chunks[0].sectionHeading, "Introduction");
  });

  it("keeps tables as atomic units", () => {
    const text = [
      "# Data",
      "| Name | Value |",
      "| Alice | 10 |",
      "| Bob | 20 |",
    ].join("\n");

    const chunks = chunkStructured(text, "Report");
    assert.strictEqual(chunks[0].chunkType, "table");
  });
});

// ---------------------------------------------------------------------------
// chunkLinks
// ---------------------------------------------------------------------------

describe("chunkLinks", () => {
  it("creates one chunk per URL", () => {
    const text = [
      "Main: https://example.com",
      "Docs: https://docs.example.com",
      "API: https://api.example.com",
    ].join("\n");

    const chunks = chunkLinks(text, "Resources");
    assert.strictEqual(chunks.length, 3);
    for (const chunk of chunks) {
      assert.strictEqual(chunk.chunkType, "link");
      assert.ok(chunk.content.includes("https://"));
    }
  });

  it("includes surrounding description text", () => {
    const text = "Visit https://example.com for the full guide.";
    const chunks = chunkLinks(text, "Guide");
    assert.strictEqual(chunks.length, 1);
    assert.ok(chunks[0].content.includes("Visit"));
    assert.ok(chunks[0].content.includes("full guide"));
  });
});

// ---------------------------------------------------------------------------
// chunkDocument (integration)
// ---------------------------------------------------------------------------

describe("chunkDocument", () => {
  it("returns empty array for no pages", () => {
    const result = chunkDocument([], "Empty");
    assert.deepStrictEqual(result, []);
  });

  it("processes a multi-page structured document", () => {
    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: "# Overview\nThis is the overview section with enough content.",
        qualityScore: 0.9,
        ocrUsed: false,
      },
      {
        pageNumber: 2,
        text: "## Details\nHere are the detailed instructions for the process.",
        qualityScore: 0.85,
        ocrUsed: false,
      },
    ];

    const chunks = chunkDocument(pages, "Handbook");
    assert.ok(chunks.length > 0, "Should produce at least one chunk");
    assert.ok(
      chunks[0].breadcrumb.includes("Handbook"),
      "Breadcrumb should include document title",
    );
  });

  it("processes a prose document", () => {
    const longParagraph =
      "The quick brown fox jumps over the lazy dog. ".repeat(80);
    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: longParagraph,
        qualityScore: 0.95,
        ocrUsed: false,
      },
    ];

    const chunks = chunkDocument(pages, "Story");
    assert.ok(chunks.length > 1, "Long prose should produce multiple chunks");
    for (const chunk of chunks) {
      assert.strictEqual(chunk.chunkType, "prose");
    }
  });

  it("processes a links document", () => {
    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: [
          "Resource 1: https://example.com/a",
          "Resource 2: https://example.com/b",
          "Resource 3: https://example.com/c",
        ].join("\n"),
        qualityScore: 1,
        ocrUsed: false,
      },
    ];

    const chunks = chunkDocument(pages, "Links Page");
    assert.ok(chunks.length >= 3, "Should have at least 3 link chunks");
    for (const chunk of chunks) {
      assert.strictEqual(chunk.chunkType, "link");
    }
  });
});
