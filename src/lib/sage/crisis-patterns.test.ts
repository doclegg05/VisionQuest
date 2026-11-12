import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  EN_SHOULD_MATCH,
  EN_SHOULD_NOT_MATCH,
  ES_SHOULD_MATCH,
  ES_SHOULD_NOT_MATCH,
  INFORMAL_MUST_DETECT,
  INFORMAL_MUST_NOT_DETECT,
} from "./crisis-fixtures";
import { detectCrisisSignal } from "./crisis-patterns";

// E9b 1: the chat in the browser runs the crisis scan itself when it cuts a
// send off before the server's first event. The scan must load there (no
// server imports) and be the very scan the server runs. crisis-detection.ts
// re-exports it unchanged; its own suites (crisis-detection*.test.ts) and the
// crisis-en benchmark keep pinning what it matches.

const PURE_FILES = ["src/lib/sage/crisis-patterns.ts", "src/lib/sage/crisis-patterns-residual.ts"];
const ALLOWED_IMPORTS = new Set(["./crisis-patterns", "./crisis-patterns-residual"]);

function importsOf(path: string): string[] {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(/^import[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[1]);
}

describe("the crisis patterns load in the browser (E9b 1)", () => {
  for (const path of PURE_FILES) {
    it(`${path} imports nothing but its own pattern files`, () => {
      const outside = importsOf(path).filter((spec) => !ALLOWED_IMPORTS.has(spec));
      assert.deepEqual(outside, []);
    });
  }

  it("the 988 module the chat imports reads the patterns from the pure file", () => {
    const imports = importsOf("src/lib/chat/crisis-safety-net.ts");
    assert.ok(imports.includes("@/lib/sage/crisis-patterns"), imports.join(", "));
    assert.ok(!imports.includes("@/lib/sage/crisis-detection"), imports.join(", "));
  });

  it("the server module re-exports the same scan, not a copy", () => {
    const source = readFileSync("src/lib/sage/crisis-detection.ts", "utf8");
    assert.match(source, /export \{\s*detectCrisisSignal,[^}]*\} from "\.\/crisis-patterns";/);
    assert.doesNotMatch(source, /function detectCrisisSignal|CRISIS_PATTERNS/);
  });
});

describe("the scan still reads every pinned case the same way (E9b 1)", () => {
  it("matches the pinned English and Spanish crises with their category and language", () => {
    for (const { text, category } of EN_SHOULD_MATCH) {
      assert.deepEqual(detectCrisisSignal(text), { matched: true, category, lang: "en" }, text);
    }
    for (const { text, category } of ES_SHOULD_MATCH) {
      const found = detectCrisisSignal(text);
      assert.equal(found.matched, true, text);
      assert.equal(found.category, category, text);
    }
  });

  it("stays silent on the pinned look-alikes", () => {
    for (const text of [...EN_SHOULD_NOT_MATCH, ...ES_SHOULD_NOT_MATCH]) {
      assert.equal(detectCrisisSignal(text).matched, false, text);
    }
  });

  it("keeps the informal register", () => {
    for (const [text] of INFORMAL_MUST_DETECT) assert.equal(detectCrisisSignal(text).matched, true, text);
    for (const [text] of INFORMAL_MUST_NOT_DETECT) assert.equal(detectCrisisSignal(text).matched, false, text);
  });
});
