import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  EN_SHOULD_MATCH,
  EN_SHOULD_NOT_MATCH,
  ES_SHOULD_MATCH,
  ES_SHOULD_NOT_MATCH,
  INFORMAL_MUST_DETECT,
  INFORMAL_MUST_NOT_DETECT,
} from "@/lib/sage/crisis-fixtures";

// ---------------------------------------------------------------------------
// The benchmark corpora are checked by `npm test`, not only by the benchmark.
//
// config/benchmarks/fixtures/crisis-{en,es}.json carry rows tagged
// `source: "pinned-test"` that are copies of what the two crisis test files
// pin. A copy can drift. If it drifts, the benchmark starts reporting a number
// that contradicts a test — a fixture passing for the wrong reason, which the
// 2026-08-21 crisis review called worse than no fixture at all.
//
// So the cross-check runs here as well as inside each suite's --self-test:
// adding a pinned case without adding it to a corpus, or relabelling a corpus
// row away from what the unit suite asserts, turns `npm test` red. The
// benchmark runner is not needed for that to happen.
//
// The scorer itself is exercised by the suites' --self-test; this file only
// guards the agreement between the two sources of truth, plus the corpus size
// floors the design specifies (so a corpus cannot be quietly emptied to make a
// number move).
// ---------------------------------------------------------------------------

// The repo root, resolved the way every other path-reading test here does it
// (`process.cwd()`): tsx compiles these to CJS, where `import.meta.dirname` is
// undefined and fails at load time rather than in an assertion.
const REPO_ROOT = process.cwd();

interface CorpusRow {
  text: string;
  label: "detect" | "silent";
  family: string;
  bucket: "must_detect" | "hard_negative" | "neutral";
  source: "pinned-test" | "authored";
  category?: string;
  reviewed?: boolean;
}

function loadCorpus(language: "en" | "es"): { rows: CorpusRow[] } {
  return JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, "config", "benchmarks", "fixtures", `crisis-${language}.json`),
      "utf8",
    ),
  ) as { rows: CorpusRow[] };
}

const EN = loadCorpus("en");
const ES = loadCorpus("es");
const ALL_ROWS = [...EN.rows, ...ES.rows];

/** Every phrase the unit suite pins, with the label it pins for it. */
function pinnedExpectations(): Map<string, { label: "detect" | "silent"; category?: string }> {
  const expected = new Map<string, { label: "detect" | "silent"; category?: string }>();
  for (const { text, category } of EN_SHOULD_MATCH) expected.set(text, { label: "detect", category });
  for (const text of EN_SHOULD_NOT_MATCH) expected.set(text, { label: "silent" });
  for (const { text, category } of ES_SHOULD_MATCH) expected.set(text, { label: "detect", category });
  for (const text of ES_SHOULD_NOT_MATCH) expected.set(text, { label: "silent" });
  for (const [text] of INFORMAL_MUST_DETECT) expected.set(text, { label: "detect" });
  for (const [text] of INFORMAL_MUST_NOT_DETECT) expected.set(text, { label: "silent" });
  return expected;
}

function countBucket(rows: CorpusRow[], bucket: CorpusRow["bucket"]): number {
  return rows.filter((row) => row.bucket === bucket).length;
}

describe("benchmark crisis corpora agree with the pinned unit fixtures", () => {
  const expected = pinnedExpectations();

  it("every pinned-test row exists verbatim in crisis-fixtures.ts", () => {
    const orphans = ALL_ROWS.filter(
      (row) => row.source === "pinned-test" && !expected.has(row.text),
    ).map((row) => row.text);
    assert.deepEqual(
      orphans,
      [],
      "these corpus rows claim source:\"pinned-test\" but their exact text is in no pinned array",
    );
  });

  it("every pinned-test row carries the label the unit suite pins", () => {
    const disagreements: string[] = [];
    for (const row of ALL_ROWS) {
      if (row.source !== "pinned-test") continue;
      const want = expected.get(row.text);
      if (!want) continue; // covered by the test above
      if (want.label !== row.label) {
        disagreements.push(`${JSON.stringify(row.text)}: corpus "${row.label}" vs pinned "${want.label}"`);
      }
      if (want.category && row.category && want.category !== row.category) {
        disagreements.push(
          `${JSON.stringify(row.text)}: corpus category "${row.category}" vs pinned "${want.category}"`,
        );
      }
    }
    assert.deepEqual(disagreements, [], "a benchmark row must never contradict a pinned test");
  });

  it("every pinned phrase appears in one of the two corpora", () => {
    // The other direction. Without this, adding a pinned case and forgetting
    // the corpus silently shrinks what the benchmark covers, and the number
    // still looks fine.
    const present = new Set(ALL_ROWS.map((row) => row.text));
    const missing = [...expected.keys()].filter((text) => !present.has(text));
    assert.deepEqual(missing, [], "these pinned phrases reached neither benchmark corpus");
  });

  it("a detect row is always in the must_detect bucket, and never the reverse", () => {
    for (const row of ALL_ROWS) {
      if (row.label === "detect") assert.equal(row.bucket, "must_detect", row.text);
      else assert.notEqual(row.bucket, "must_detect", row.text);
    }
  });

  it("no exact duplicate rows, and no case-only duplicates between authored rows", () => {
    for (const corpus of [EN, ES]) {
      const seenExact = new Set<string>();
      const seenLower = new Map<string, CorpusRow>();
      for (const row of corpus.rows) {
        assert.ok(!seenExact.has(row.text), `duplicate row: ${JSON.stringify(row.text)}`);
        seenExact.add(row.text);
        const lower = row.text.toLowerCase();
        const prior = seenLower.get(lower);
        // A case-only pair is allowed only when a pinned row is involved: the
        // unit suite pins both "i wanna die" and "I wanna die" on purpose.
        if (prior && prior.source === "authored" && row.source === "authored") {
          assert.fail(`case-only duplicate authored row: ${JSON.stringify(row.text)}`);
        }
        if (!prior) seenLower.set(lower, row);
      }
    }
  });
});

describe("benchmark crisis corpora meet their size floors", () => {
  // The design (docs/superpowers/specs/2026-09-05-benchmark-suite-design.md
  // §4.1) specifies these sizes. Pinning them stops a corpus being trimmed
  // until an inconvenient number improves.
  it("crisis-en carries at least 200 / 300 / 100", () => {
    assert.ok(countBucket(EN.rows, "must_detect") >= 200, `must_detect ${countBucket(EN.rows, "must_detect")}`);
    assert.ok(
      countBucket(EN.rows, "hard_negative") >= 300,
      `hard_negative ${countBucket(EN.rows, "hard_negative")}`,
    );
    assert.ok(countBucket(EN.rows, "neutral") >= 100, `neutral ${countBucket(EN.rows, "neutral")}`);
  });

  it("crisis-es carries at least 150 / 200 / 100", () => {
    assert.ok(countBucket(ES.rows, "must_detect") >= 150, `must_detect ${countBucket(ES.rows, "must_detect")}`);
    assert.ok(
      countBucket(ES.rows, "hard_negative") >= 200,
      `hard_negative ${countBucket(ES.rows, "hard_negative")}`,
    );
    assert.ok(countBucket(ES.rows, "neutral") >= 100, `neutral ${countBucket(ES.rows, "neutral")}`);
  });

  it("the three named means families are represented in BOTH languages", () => {
    // The detector has no patterns for these. The corpus rows are the only
    // reason the gap is a number rather than a memory, so losing them would
    // make recall jump without anything improving.
    for (const [name, corpus] of [
      ["crisis-en", EN],
      ["crisis-es", ES],
    ] as const) {
      for (const family of ["means_firearm", "means_hanging", "means_jumping"]) {
        const n = corpus.rows.filter((row) => row.family === family).length;
        assert.ok(n >= 8, `${name} has only ${n} ${family} rows; the coverage gap must stay measurable`);
      }
    }
  });
});

describe("the Spanish corpus records that it is unreviewed", () => {
  it("no Spanish row claims a native-speaker review yet", () => {
    // Owner step. crisis-es runs at watch tier for exactly this reason, and
    // flipping a flag here without the review would quietly promote the suite's
    // credibility ahead of the fact.
    const claimed = ES.rows.filter((row) => row.reviewed === true).map((row) => row.text);
    assert.deepEqual(
      claimed,
      [],
      "a Spanish row is marked reviewed:true — record who reviewed it in the fixture header first",
    );
  });

  it("every Spanish row carries the reviewed flag at all", () => {
    const missing = ES.rows.filter((row) => typeof row.reviewed !== "boolean").map((row) => row.text);
    assert.deepEqual(missing, [], "these Spanish rows have no reviewed flag");
  });
});
