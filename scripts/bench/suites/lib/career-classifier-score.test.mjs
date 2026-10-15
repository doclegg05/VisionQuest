import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  brierScore,
  flipRate,
  isTop1Correct,
  nationalScoreMap,
  summarize,
  toDistribution,
  topLabels,
  transcriptState,
  validateFixture,
} from "./career-classifier-score.mjs";

const SPOKES = ["office-admin", "tech-digital", "career-readiness"];
const NATIONAL = ["Construction", "Digital Technology", "Financial Services"];

describe("topLabels", () => {
  it("returns the single highest-scoring known label", () => {
    assert.deepEqual(topLabels({ "office-admin": 0.2, "tech-digital": 0.9 }, SPOKES), ["tech-digital"]);
  });

  it("returns every label tied for the top, in canonical order", () => {
    assert.deepEqual(
      topLabels({ "tech-digital": 0.8, "office-admin": 0.8, "career-readiness": 0.1 }, SPOKES),
      ["office-admin", "tech-digital"],
    );
  });

  it("returns nothing when every score is zero or the map is empty (a failed extraction)", () => {
    assert.deepEqual(topLabels({}, SPOKES), []);
    assert.deepEqual(topLabels({ "office-admin": 0, "tech-digital": 0 }, SPOKES), []);
  });

  it("ignores labels outside the vocabulary", () => {
    assert.deepEqual(topLabels({ "made-up": 1, "office-admin": 0.3 }, SPOKES), ["office-admin"]);
  });
});

describe("isTop1Correct", () => {
  it("is correct when the single top label is gold or acceptable", () => {
    assert.equal(isTop1Correct(["office-admin"], "office-admin"), true);
    assert.equal(isTop1Correct(["tech-digital"], "office-admin", ["tech-digital"]), true);
    assert.equal(isTop1Correct(["career-readiness"], "office-admin", ["tech-digital"]), false);
  });

  it("does not reward a tie unless every tied label is right", () => {
    assert.equal(isTop1Correct(["office-admin", "career-readiness"], "office-admin"), false);
    assert.equal(isTop1Correct(["office-admin", "tech-digital"], "office-admin", ["tech-digital"]), true);
  });

  it("is never correct with no prediction", () => {
    assert.equal(isTop1Correct([], "office-admin"), false);
  });
});

describe("toDistribution and brierScore", () => {
  it("normalises scores over the whole vocabulary", () => {
    const dist = toDistribution({ "office-admin": 0.6, "tech-digital": 0.2 }, SPOKES);
    assert.deepEqual(Object.keys(dist), SPOKES);
    const expected = { "office-admin": 0.75, "tech-digital": 0.25, "career-readiness": 0 };
    for (const label of SPOKES) assert.ok(Math.abs(dist[label] - expected[label]) < 1e-9, label);
  });

  it("has no distribution when nothing was scored", () => {
    assert.equal(toDistribution({}, SPOKES), null);
    assert.equal(brierScore(null, "office-admin", SPOKES), null);
  });

  it("scores 0 for a certain correct answer and 2 for a certain wrong one", () => {
    const right = { "office-admin": 1, "tech-digital": 0, "career-readiness": 0 };
    const wrong = { "office-admin": 0, "tech-digital": 1, "career-readiness": 0 };
    assert.equal(brierScore(right, "office-admin", SPOKES), 0);
    assert.equal(brierScore(wrong, "office-admin", SPOKES), 2);
  });
});

describe("nationalScoreMap", () => {
  it("keys the extractor's cluster list by name, keeping the higher duplicate", () => {
    assert.deepEqual(
      nationalScoreMap([
        { cluster_name: "Construction", score: 0.4 },
        { cluster_name: "Construction", score: 0.7 },
        { cluster_name: "Digital Technology", score: 0.5 },
      ]),
      { Construction: 0.7, "Digital Technology": 0.5 },
    );
  });
});

describe("transcriptState", () => {
  it("keeps the same last-10 window the extractor reads, with plain speaker names", () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? "model" : "user",
      content: `m${i}`,
    }));
    const state = transcriptState(messages);
    assert.equal(state.length, 10);
    assert.deepEqual(state[0], { speaker: "Sage", text: "m2" });
    assert.deepEqual(state[9], { speaker: "Student", text: "m11" });
  });
});

describe("flipRate", () => {
  it("is the share of pairs whose answer changed when the options were reversed", () => {
    assert.equal(flipRate([{ a: "x", b: "x" }, { a: "x", b: "y" }]), 0.5);
    assert.equal(flipRate([]), null);
  });
});

describe("summarize", () => {
  const rows = [
    { lang: "en", goldSpokes: "office-admin", failed: false, correctSpokes: true, correctNational: true, brier: 0.1, latencyMs: 100 },
    { lang: "en", goldSpokes: "tech-digital", failed: false, correctSpokes: false, correctNational: true, brier: 0.9, latencyMs: 300 },
    { lang: "es", goldSpokes: "office-admin", failed: true, correctSpokes: false, correctNational: false, brier: null, latencyMs: 200 },
    { lang: "es", goldSpokes: "tech-digital", failed: false, correctSpokes: true, correctNational: false, brier: 0.3, latencyMs: 400 },
  ];

  it("counts a failed row as wrong, and averages Brier only over scored rows", () => {
    const summary = summarize(rows);
    assert.equal(summary.n, 4);
    assert.equal(summary.spokesTop1, 0.5);
    assert.equal(summary.nationalTop1, 0.5);
    assert.equal(summary.failureRate, 0.25);
    assert.equal(summary.spokesBrier, 0.4333);
    assert.equal(summary.p50Ms, 200);
  });

  it("splits by language and by gold label", () => {
    const summary = summarize(rows);
    assert.equal(summary.byLang.en.spokesTop1, 0.5);
    assert.equal(summary.byLang.es.failureRate, 0.5);
    assert.equal(summary.byGold["office-admin"].spokesTop1, 0.5);
  });

  it("returns nulls rather than NaN for an empty arm", () => {
    const summary = summarize([]);
    assert.equal(summary.n, 0);
    assert.equal(summary.spokesTop1, null);
    assert.equal(summary.p50Ms, null);
  });
});

describe("validateFixture", () => {
  const vocab = { spokesIds: SPOKES, nationalNames: NATIONAL };
  const goodCase = (id, lang, pair) => ({
    id,
    pair,
    lang,
    difficulty: "clear",
    messages: [
      { role: "model", content: "What kind of work do you like?" },
      { role: "user", content: "Fixing computers." },
    ],
    gold: { spokes: "tech-digital", national: "Digital Technology" },
    acceptable: { spokes: [], national: [] },
  });

  it("accepts a well-formed English/Spanish pair", () => {
    const fixture = { cases: [goodCase("t-01", "en", "t-01"), goodCase("t-01-es", "es", "t-01")] };
    assert.deepEqual(validateFixture(fixture, vocab), []);
  });

  it("names every problem it finds", () => {
    const bad = goodCase("t-02", "en", "t-02");
    const problems = validateFixture(
      {
        cases: [
          { ...bad, gold: { spokes: "welding", national: "Digital Technology" } },
          { ...goodCase("t-03", "en", "t-03"), acceptable: { spokes: ["tech-digital"], national: [] } },
          { ...goodCase("t-04", "en", "t-04"), messages: [{ role: "user", content: "hi" }] },
          goodCase("t-04", "es", "t-04"),
        ],
      },
      vocab,
    );
    const text = problems.join("\n");
    assert.match(text, /t-02.*unknown gold spokes "welding"/);
    assert.match(text, /t-02.*no Spanish pair/);
    assert.match(text, /t-03.*repeats its gold/);
    assert.match(text, /t-04.*start with a Sage turn/);
    assert.match(text, /t-04.*duplicate id/);
  });
});
