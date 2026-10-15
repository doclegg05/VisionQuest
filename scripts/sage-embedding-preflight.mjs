#!/usr/bin/env node

/**
 * One embedding call through GeminiEmbeddingProvider, the provider the app's
 * embedding resolver returns in CI, to learn whether GEMINI_API_KEY can embed
 * before an eval that depends on it starts.
 *
 * The memory and answer-quality evals generate through OpenRouter but embed
 * through the app's Gemini path, and both swallow embedding errors: a refused
 * key used to read as a 0% retrieval score. scripts/lib/sage-eval-ci-step.mjs
 * runs this first for every --needs-gemini-embeddings step.
 *
 * Exit 0: the key embeds. 3: the wallet is empty. 4: the key or model was
 * refused, or Google could not be reached. 1: anything else.
 *
 * The text is a fixed synthetic sentence. Does not read .env.local.
 *
 * Usage: node --import tsx scripts/sage-embedding-preflight.mjs
 */

import { classifyEmbeddingFailure, reportEvalFailure } from "./lib/sage-eval-provider.mjs";

const PREFLIGHT_TEXT = "Sage eval embedding preflight.";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY missing: the embedding preflight needs it.");
  const { GeminiEmbeddingProvider } = await import("../src/lib/ai/gemini-embedding-provider.ts");
  const provider = new GeminiEmbeddingProvider(apiKey);
  try {
    await provider.embed([PREFLIGHT_TEXT], { taskType: "RETRIEVAL_QUERY", callSite: "sage_eval_embedding_preflight" });
  } catch (error) {
    throw classifyEmbeddingFailure(error);
  }
  console.log(`Gemini embeddings reachable (${provider.model}).`);
}

main().catch(reportEvalFailure);
