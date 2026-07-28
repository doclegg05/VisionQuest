import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { validateFixturePrivacy } from "./privacy.mjs";
import { estimateRunCost, PRICING_SNAPSHOT } from "./pricing.mjs";
import {
  buildGeminiHttpRequest,
  buildOpenAiHttpRequest,
  normalizeBenchmarkRequest,
  runProviderRequest,
} from "./providers.mjs";
import { evaluateSwitchDecision } from "./scoring.mjs";
import { validateOutput } from "./validity.mjs";

const fixtureUrl = new URL("../../config/ai-provider-benchmark.json", import.meta.url);

async function loadFixtures() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

function sseResponse(blocks) {
  return new Response(blocks.join("\n\n") + "\n\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function completedScores(outputIds, valueByProvider, blindKey) {
  const providerById = new Map(blindKey.map((entry) => [entry.outputId, entry.provider]));
  return outputIds.map((outputId) => {
    const value = valueByProvider[providerById.get(outputId)];
    return {
      output_id: outputId,
      quality: String(value),
      grounding: String(value),
      clarity: String(value),
      tone: String(value),
      safety: String(value),
    };
  });
}

function decisionRuns({ geminiDuration = 100, openaiDuration = 100 } = {}) {
  return [
    {
      status: "ok",
      provider: "gemini",
      firstTokenMs: 50,
      durationMs: geminiDuration,
      estimatedCostUsd: 0.01,
      outputValidity: { valid: true },
    },
    {
      status: "ok",
      provider: "openai",
      firstTokenMs: 50,
      durationMs: openaiDuration,
      estimatedCostUsd: 0.01,
      outputValidity: { valid: true },
    },
  ];
}

describe("benchmark fixture privacy", () => {
  it("accepts the bundled public synthetic fixture set", async () => {
    const fixtures = await loadFixtures();
    const result = validateFixturePrivacy(fixtures);
    assert.deepEqual(result, { valid: true, errors: [] });
    assert.equal(fixtures.repetitions, 3);
    assert.deepEqual(
      new Set(fixtures.cases.map((testCase) => testCase.category)),
      new Set([
        "student_coaching",
        "instructor_summary",
        "structured_json",
        "retrieval_grounding",
        "safety_privacy",
      ]),
    );
  });

  it("rejects protected-data field names and direct identifiers before any request", async () => {
    const fixtures = await loadFixtures();
    const unsafe = structuredClone(fixtures);
    unsafe.cases[0].studentId = "record-123";
    unsafe.cases[0].context += " Contact learner@example.org.";
    const result = validateFixturePrivacy(unsafe);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("protected-data field name")));
    assert.ok(result.errors.some((error) => error.includes("email address")));
  });
});

describe("cost and output validity calculations", () => {
  it("calculates documented Gemini and OpenAI token costs", () => {
    assert.equal(
      estimateRunCost("gemini", { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      1.75,
    );
    assert.equal(
      estimateRunCost("openai", {
        inputTokens: 1_000_000,
        cachedInputTokens: 200_000,
        outputTokens: 1_000_000,
      }),
      2.205,
    );
    assert.equal(PRICING_SNAPSHOT.providers.gemini.outputPerMillion, 1.5);
    assert.equal(PRICING_SNAPSHOT.providers.openai.outputPerMillion, 2);
  });

  it("checks structured JSON shape and number ranges without provider-specific helpers", () => {
    const specification = {
      json: {
        requiredKeys: ["goal", "confidence"],
        exactKeys: true,
        types: { goal: "string", confidence: "number" },
        numberRanges: { confidence: [0, 1] },
      },
    };
    assert.equal(validateOutput('{"goal":"Practice","confidence":0.8}', specification).valid, true);
    assert.equal(validateOutput('{"goal":"Practice","confidence":4}', specification).valid, false);
  });
});

describe("provider request normalization with mocked streaming APIs", () => {
  it("maps the same canonical system prompt, context, prompt, and token limit to both providers", async () => {
    const config = await loadFixtures();
    const canonical = normalizeBenchmarkRequest(config, config.cases[0]);
    const gemini = buildGeminiHttpRequest(canonical, {
      apiKey: "gemini-placeholder",
      model: "gemini-3.1-flash-lite",
    });
    const openai = buildOpenAiHttpRequest(canonical, {
      apiKey: "openai-placeholder",
      model: "gpt-5-mini",
    });
    const geminiBody = JSON.parse(gemini.init.body);
    const openaiBody = JSON.parse(openai.init.body);

    assert.equal(geminiBody.systemInstruction.parts[0].text, openaiBody.instructions);
    assert.equal(geminiBody.contents[0].parts[0].text, openaiBody.input);
    assert.equal(geminiBody.generationConfig.maxOutputTokens, openaiBody.max_output_tokens);
    assert.equal(gemini.url.includes("gemini-placeholder"), false);
    assert.equal(openai.url.includes("openai-placeholder"), false);
  });

  it("parses Gemini and OpenAI streams and captures token usage through fetch mocks", async () => {
    const config = await loadFixtures();
    const canonical = normalizeBenchmarkRequest(config, config.cases[0]);
    const captured = [];
    const mockGeminiFetch = async (url, init) => {
      captured.push({ provider: "gemini", url, init });
      return sseResponse([
        `data: ${JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Gemini answer" }] } }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            thoughtsTokenCount: 2,
            totalTokenCount: 17,
          },
          responseId: "gemini-response",
        })}`,
      ]);
    };
    const mockOpenAiFetch = async (url, init) => {
      captured.push({ provider: "openai", url, init });
      return sseResponse([
        `event: response.output_text.delta\ndata: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: "OpenAI answer",
        })}`,
        `event: response.completed\ndata: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "openai-response",
            usage: {
              input_tokens: 11,
              output_tokens: 6,
              input_tokens_details: { cached_tokens: 1 },
            },
          },
        })}`,
      ]);
    };

    const gemini = await runProviderRequest("gemini", canonical, {
      apiKey: "gemini-placeholder",
      model: "gemini-3.1-flash-lite",
      fetchImpl: mockGeminiFetch,
    });
    const openai = await runProviderRequest("openai", canonical, {
      apiKey: "openai-placeholder",
      model: "gpt-5-mini",
      fetchImpl: mockOpenAiFetch,
    });

    assert.equal(gemini.output, "Gemini answer");
    assert.equal(gemini.usage.outputTokens, 7);
    assert.equal(openai.output, "OpenAI answer");
    assert.equal(openai.usage.cachedInputTokens, 1);
    assert.equal(captured.length, 2);
  });
});

describe("human scoring decision rule", () => {
  const blindKey = [
    { outputId: "case-r1-A", provider: "gemini" },
    { outputId: "case-r1-B", provider: "openai" },
  ];
  const outputIds = blindKey.map((entry) => entry.outputId);

  it("switches for at least a 0.4-point composite quality advantage", () => {
    const scoreRows = completedScores(outputIds, { gemini: 4, openai: 4.5 }, blindKey);
    const decision = evaluateSwitchDecision({ scoreRows, blindKey, runs: decisionRuns() });
    assert.equal(decision.shouldSwitch, true);
    assert.equal(decision.rationale.qualityWin, true);
  });

  it("switches at equal quality with at least a 20% full-duration advantage", () => {
    const scoreRows = completedScores(outputIds, { gemini: 4, openai: 4 }, blindKey);
    const decision = evaluateSwitchDecision({
      scoreRows,
      blindKey,
      runs: decisionRuns({ geminiDuration: 100, openaiDuration: 75 }),
    });
    assert.equal(decision.shouldSwitch, true);
    assert.equal(decision.rationale.performanceWin, true);
  });

  it("never recommends switching when the safety score is materially worse", () => {
    const scoreRows = completedScores(outputIds, { gemini: 4, openai: 4.5 }, blindKey);
    scoreRows.find((row) => row.output_id === "case-r1-B").safety = "3";
    const decision = evaluateSwitchDecision({ scoreRows, blindKey, runs: decisionRuns() });
    assert.equal(decision.shouldSwitch, false);
    assert.equal(decision.rationale.safetyNonInferior, false);
  });
});
