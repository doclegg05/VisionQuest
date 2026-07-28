#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createBlindPacket, summarizeRuns, writeRunArtifacts } from "./artifacts.mjs";
import { assertFixturePrivacy } from "./privacy.mjs";
import { estimateRunCost, PRICING_SNAPSHOT } from "./pricing.mjs";
import { normalizeBenchmarkRequest, PROVIDER_DEFAULTS, runProviderRequest } from "./providers.mjs";
import { validateOutput } from "./validity.mjs";

const DEFAULT_FIXTURE_PATH = "config/ai-provider-benchmark.json";
const DOCUMENTATION_SOURCES = Object.freeze([
  "https://ai.google.dev/api/generate-content",
  "https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite",
  "https://ai.google.dev/gemini-api/docs/pricing",
  "https://developers.openai.com/api/docs/models/gpt-5-mini",
  "https://developers.openai.com/api/docs/guides/streaming-responses",
]);

function parseArguments(argv) {
  const result = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (!["--fixtures", "--out", "--seed"].includes(name)) {
      throw new Error(`Unknown argument "${argument}"`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value) throw new Error(`${name} requires a value`);
    result[name.slice(2)] = value;
  }
  return result;
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function buildRunPlan(config, random) {
  const plan = [];
  for (const testCase of config.cases) {
    for (let repetition = 1; repetition <= config.repetitions; repetition += 1) {
      for (const provider of ["gemini", "openai"]) {
        plan.push({ provider, repetition, testCase });
      }
    }
  }
  return shuffle(plan, random);
}

function resolveProviderOptions() {
  return {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL?.trim() || PROVIDER_DEFAULTS.gemini.model,
      baseUrl: process.env.GEMINI_BENCHMARK_BASE_URL?.trim() || PROVIDER_DEFAULTS.gemini.baseUrl,
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL?.trim() || PROVIDER_DEFAULTS.openai.model,
      baseUrl: process.env.OPENAI_BASE_URL?.trim() || PROVIDER_DEFAULTS.openai.baseUrl,
    },
  };
}

function assertConfiguration(config, providerOptions) {
  if (config.repetitions !== 3) throw new Error("Benchmark fixture must specify exactly 3 repetitions.");
  if (!Number.isInteger(config.generation?.maxOutputTokens) || config.generation.maxOutputTokens < 1) {
    throw new Error("generation.maxOutputTokens must be a positive integer.");
  }
  for (const [provider, options] of Object.entries(providerOptions)) {
    if (!options.apiKey) {
      throw new Error(`${provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"} is required.`);
    }
  }
}

function requestHash(canonical) {
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const fixturePath = resolve(args.fixtures || DEFAULT_FIXTURE_PATH);
  const fixtureText = await readFile(fixturePath, "utf8");
  const config = JSON.parse(fixtureText);
  const privacy = assertFixturePrivacy(config);
  const seed = args.seed === undefined ? randomBytes(4).readUInt32LE() : Number(args.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error("--seed must be an integer between 0 and 4294967295.");
  }

  const random = createSeededRandom(seed);
  const plan = buildRunPlan(config, random);
  const providerOptions = resolveProviderOptions();

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          valid: true,
          benchmarkId: config.benchmarkId,
          dataClassification: config.dataClassification,
          cases: config.cases.length,
          repetitions: config.repetitions,
          plannedCalls: plan.length,
          randomizedSeed: seed,
          providers: Object.fromEntries(
            Object.entries(providerOptions).map(([provider, options]) => [provider, { model: options.model }]),
          ),
        },
        null,
        2,
      ),
    );
    return;
  }

  assertConfiguration(config, providerOptions);
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const outputDirectory = resolve(args.out || `artifacts/ai-benchmark/${runId}`);
  const runs = [];
  const startedAt = new Date().toISOString();

  for (const [index, planned] of plan.entries()) {
    const { provider, repetition, testCase } = planned;
    const options = providerOptions[provider];
    const canonical = normalizeBenchmarkRequest(config, testCase);
    const runStartedAt = new Date().toISOString();
    process.stdout.write(
      `[${index + 1}/${plan.length}] ${testCase.id} repetition ${repetition} (${provider}) ... `,
    );

    try {
      const response = await runProviderRequest(provider, canonical, options);
      const outputValidity = validateOutput(response.output, testCase.validity);
      const estimatedCostUsd = response.usage
        ? estimateRunCost(provider, response.usage, PRICING_SNAPSHOT)
        : null;
      runs.push({
        runId,
        sequence: index + 1,
        caseId: testCase.id,
        category: testCase.category,
        repetition,
        provider,
        model: options.model,
        status: "ok",
        startedAt: runStartedAt,
        canonicalRequestSha256: requestHash(canonical),
        firstTokenMs: response.firstTokenMs,
        durationMs: response.durationMs,
        usage: response.usage,
        estimatedCostUsd,
        outputValidity,
        providerResponseId: response.providerResponseId,
        providerModelVersion: response.providerModelVersion,
        output: response.output,
      });
      console.log(outputValidity.valid ? "ok" : "invalid output");
    } catch (error) {
      runs.push({
        runId,
        sequence: index + 1,
        caseId: testCase.id,
        category: testCase.category,
        repetition,
        provider,
        model: options.model,
        status: "error",
        startedAt: runStartedAt,
        canonicalRequestSha256: requestHash(canonical),
        error: error instanceof Error ? error.message : String(error),
      });
      console.log("failed");
    }
  }

  const completedAt = new Date().toISOString();
  const blind = createBlindPacket(runs, random);
  const summary = {
    benchmarkId: config.benchmarkId,
    runId,
    requiresHumanScoring: true,
    providers: summarizeRuns(runs),
  };
  const manifest = {
    schemaVersion: 1,
    benchmarkId: config.benchmarkId,
    runId,
    startedAt,
    completedAt,
    fixturePath,
    fixtureSha256: createHash("sha256").update(fixtureText).digest("hex"),
    dataClassification: config.dataClassification,
    privacyValidation: privacy,
    cases: config.cases.map(({ id, category }) => ({ id, category })),
    repetitions: config.repetitions,
    plannedCalls: plan.length,
    randomizedSeed: seed,
    generation: config.generation,
    providers: Object.fromEntries(
      Object.entries(providerOptions).map(([provider, options]) => [provider, { model: options.model }]),
    ),
    pricingSnapshot: PRICING_SNAPSHOT,
    documentationSources: DOCUMENTATION_SOURCES,
  };

  await writeRunArtifacts(outputDirectory, { manifest, runs, summary, blind });
  console.log(`Artifacts written to ${outputDirectory}`);
  console.log("Complete blind-scoring.csv, then run npm run ai:benchmark:score -- --run <directory>.");
  if (runs.some((run) => run.status === "error")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
