import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildVocab, jevQuestions, runGeminiCase, runJevCase, selectCases } from "./career-classifier.mjs";

const { CAREER_CLUSTERS } = await import("../../../src/lib/spokes/career-clusters.ts");
const { NATIONAL_CAREER_CLUSTERS } = await import("../../../src/lib/spokes/national-clusters.ts");
const vocab = buildVocab({ CAREER_CLUSTERS, NATIONAL_CAREER_CLUSTERS });

const testCase = {
  id: "tech-digital-01",
  pair: "tech-digital-01",
  lang: "en",
  difficulty: "clear",
  messages: [
    { role: "model", content: "What kind of work sounds good to you?" },
    { role: "user", content: "I fix everybody's phones and laptops. I'd like to do that for a job." },
  ],
  gold: { spokes: "tech-digital", national: "Digital Technology" },
  acceptable: { spokes: [], national: [] },
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function choiceAnswer(choice, keys) {
  const probabilities = Object.fromEntries(keys.map((key) => [key, key === choice ? 1 : 0]));
  return { type: "choice", choice, probabilities, confidence: 0.9 };
}

function jevWithResponses(responses) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return queue.shift();
  };
  const jev = {
    request: { apiKey: "ts_test_key_123456789", model: "jev-1.13.0", fetchImpl, sleep: async () => {} },
    forward: jevQuestions(vocab, false),
    reversed: jevQuestions(vocab, true),
  };
  return { jev, calls };
}

const nationalKeys = vocab.nationalOptions.map((option) => option.key);
const digitalKey = vocab.nationalOptions.find((option) => option.description === "Digital Technology").key;

describe("buildVocab", () => {
  it("uses production ids and gives every national cluster a unique key that maps back to its name", () => {
    assert.deepEqual(vocab.spokesIds, CAREER_CLUSTERS.map((cluster) => cluster.id));
    assert.equal(new Set(nationalKeys).size, NATIONAL_CAREER_CLUSTERS.length);
    for (const name of NATIONAL_CAREER_CLUSTERS) {
      const option = vocab.nationalOptions.find((entry) => entry.description === name);
      assert.equal(vocab.nationalKeyToName[option.key], name);
      assert.match(option.key, /^[a-z_]+$/);
    }
  });
});

describe("runJevCase", () => {
  it("predicts from the forward call and asks the reversed call with every option list reversed", async () => {
    const forward = {
      answers: {
        spokes: choiceAnswer("tech-digital", vocab.spokesIds),
        national: choiceAnswer(digitalKey, nationalKeys),
      },
      usage: { input_tokens: 500 },
      model: "jev-1.13.0",
      provider: "TypeSafe",
    };
    const reverse = {
      answers: {
        spokes: choiceAnswer("office-admin", vocab.spokesIds),
        national: choiceAnswer(digitalKey, nationalKeys),
      },
      usage: { input_tokens: 500 },
    };
    const { jev, calls } = jevWithResponses([jsonResponse(200, forward), jsonResponse(200, reverse)]);

    const outcome = await runJevCase(jev, testCase, vocab);

    assert.equal(outcome.row.correctSpokes, true);
    assert.equal(outcome.row.correctNational, true, "the national key maps back to the gold name");
    assert.deepEqual(outcome.row.nationalTop, ["Digital Technology"]);
    assert.deepEqual(outcome.flips.spokes, { a: "tech-digital", b: "office-admin" });
    assert.equal(outcome.inputTokens, 1000);
    assert.equal(outcome.row.upstreamProvider, "TypeSafe");
    assert.deepEqual(Object.keys(calls[1].questions.spokes.criteria), [...vocab.spokesIds].reverse());
    assert.deepEqual(Object.keys(calls[1].questions.national.criteria), [...nationalKeys].reverse());
    assert.deepEqual(calls[0].state.at(-1), { speaker: "Student", text: testCase.messages[1].content });
  });

  it("records a failed case instead of throwing when the API refuses", async () => {
    const { jev } = jevWithResponses([jsonResponse(401, { error: "bad key" })]);
    const outcome = await runJevCase(jev, testCase, vocab);
    assert.equal(outcome.row.failed, true);
    assert.equal(outcome.row.correctSpokes, false);
    assert.equal(outcome.flips, null);
    assert.match(outcome.row.error, /401/);
  });
});

describe("runGeminiCase", () => {
  const goodResult = {
    cluster_scores: { "tech-digital": 0.9, "office-admin": 0.2 },
    national_career_clusters: [{ cluster_name: "Digital Technology", score: 0.8 }],
  };

  it("scores the production extractor's output", async () => {
    const row = await runGeminiCase({ makeProvider: () => ({}), extract: async () => goodResult }, testCase, vocab);
    assert.equal(row.correctSpokes, true);
    assert.equal(row.correctNational, true);
    assert.equal(row.failed, false);
  });

  it("counts the extractor's empty result and a thrown error alike as failed", async () => {
    const empty = { cluster_scores: {}, national_career_clusters: [] };
    const fromEmpty = await runGeminiCase({ makeProvider: () => ({}), extract: async () => empty }, testCase, vocab);
    const fromThrow = await runGeminiCase(
      { makeProvider: () => ({}), extract: async () => { throw new Error("provider down"); } },
      testCase,
      vocab,
    );
    for (const row of [fromEmpty, fromThrow]) {
      assert.equal(row.failed, true);
      assert.equal(row.correctSpokes, false);
    }
    assert.equal(fromThrow.error, "provider down");
  });

  it("records the upstream provider OpenRouter reported", async () => {
    const row = await runGeminiCase(
      {
        makeProvider: (onResponseMeta) => {
          onResponseMeta({ upstreamProvider: "Google Vertex", model: "google/gemini-3.1-flash-lite" });
          return {};
        },
        extract: async () => goodResult,
      },
      testCase,
      vocab,
    );
    assert.equal(row.upstreamProvider, "Google Vertex");
  });
});

describe("selectCases", () => {
  const cases = [
    { id: "a-01", pair: "a-01", lang: "en" },
    { id: "b-01", pair: "b-01", lang: "en" },
    { id: "a-01-es", pair: "a-01", lang: "es" },
    { id: "b-01-es", pair: "b-01", lang: "es" },
  ];

  it("keeps the first N English cases with their Spanish pairs", () => {
    assert.deepEqual(selectCases(cases, 1).map((c) => c.id), ["a-01", "a-01-es"]);
  });

  it("keeps everything without a usable limit", () => {
    assert.equal(selectCases(cases, Number.NaN).length, 4);
    assert.equal(selectCases(cases, 0).length, 4);
  });
});
