import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PLAIN_LANGUAGE_MAX_GRADE } from "@/lib/sage/readability";
import * as copy from "./copy";
import { scanReadabilityForRoots } from "../../../scripts/ui-copy-readability.mjs";

/**
 * The reading-level gate has to see the demo copy, or it checks nothing.
 *
 * scripts/ui-copy-readability.mjs picks strings out by the NAME they sit
 * under: JSX text, or a property or constant called title, note, message and
 * so on. Every constant in src/lib/demo/copy.ts is named DEMO_<SOMETHING>, and
 * only DEMO_SIGNIN_NOTE happens to contain a copy word, so before the scanner
 * learned to read every exported string in this one file it found that one
 * and missed ten sentences, and the gate was close to vacuous for the demo's
 * words.
 *
 * `looksCodeLike` in the scanner drops anything under six words as not prose,
 * so this compares against the same cut.
 */

const MIN_PROSE_WORDS = 6;

const demoStrings = Object.entries(copy).flatMap(([name, text]) =>
  typeof text === "string" ? [{ name, text }] : [],
);

describe("demo copy and the readability gate", () => {
  it("has exported strings to check", () => {
    assert.ok(demoStrings.length >= 10, `expected the copy file to export strings, got ${demoStrings.length}`);
  });

  it("is picked up by the scanner for every sentence long enough to be prose", async () => {
    const found = new Set((await scanReadabilityForRoots(["src/lib/demo/copy.ts"])).map((c) => c.text));

    const prose = demoStrings.filter(({ text }) => text.trim().split(/\s+/).length >= MIN_PROSE_WORDS);
    assert.ok(prose.length >= 8, `expected several prose-length strings, got ${prose.length}`);

    const missed = prose.filter(({ text }) => !found.has(text)).map(({ name }) => name);
    assert.deepEqual(missed, [], `the scanner did not extract: ${missed.join(", ")}`);
  });

  it("keeps every sentence at or under the grade ceiling, even the ones too short for the gate to score", async () => {
    // The gate only grades strings of 12 words or more, because the grade is
    // noisy on a few words. Most demo sentences are shorter than that, so check
    // the grade of all of them here: it costs nothing and catches a hard word.
    const candidates = await scanReadabilityForRoots(["src/lib/demo/copy.ts"]);
    const tooHard = candidates
      .filter((c) => c.grade > PLAIN_LANGUAGE_MAX_GRADE)
      .map((c) => `${c.text} (grade ${c.grade.toFixed(1)})`);
    assert.deepEqual(tooHard, []);
  });
});
