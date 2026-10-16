#!/usr/bin/env node

/**
 * One embedding call through OpenRouter's google/gemini-embedding-001, the
 * provider the memory and answer-quality evals embed with, to learn whether
 * OPENROUTER_API_KEY can embed before an eval that depends on it starts.
 *
 * The app's memory storage, memory retrieval and hybrid RAG swallow embedding
 * errors, so a refused key or an empty wallet used to read as a 0% retrieval
 * score. scripts/lib/sage-eval-ci-step.mjs runs this before every
 * --needs-embeddings step, and again after one fails.
 *
 * Exit 0: the key embeds. 3: credits or the key's limit ran out. 4: the key
 * or model was refused, or OpenRouter could not be reached. 1: anything else.
 *
 * The text is a fixed synthetic sentence. Does not read .env.local.
 *
 * Usage: node --import tsx scripts/sage-embedding-preflight.mjs
 */

import { classifyEmbeddingFailure, reportEvalFailure } from "./lib/sage-eval-provider.mjs";

const PREFLIGHT_TEXT = "Sage eval embedding preflight.";

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing: the embedding preflight needs it.");
  const { OpenRouterEmbeddingProvider } = await import("../src/lib/ai/openrouter-embedding-provider.ts");
  const provider = new OpenRouterEmbeddingProvider(apiKey);
  try {
    await provider.embed([PREFLIGHT_TEXT], { taskType: "RETRIEVAL_QUERY", callSite: "sage_eval_embedding_preflight" });
  } catch (error) {
    throw classifyEmbeddingFailure(error);
  }
  console.log(`OpenRouter embeddings reachable (${provider.model}).`);
}

main().catch(reportEvalFailure);
