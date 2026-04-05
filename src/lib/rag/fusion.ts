// src/lib/rag/fusion.ts

import type { ScoredChunk } from "./types";
import { SOURCE_PRIORS, IDENTIFIER_BONUS, RRF_K } from "./types";

/**
 * Fuse vector and lexical retrieval results using Reciprocal Rank Fusion (RRF)
 * with additive source priors and identifier bonuses.
 */
export function fuseResults(
  vectorResults: ScoredChunk[],
  lexicalResults: ScoredChunk[],
  identifierMatchedDocIds: Set<string>,
): ScoredChunk[] {
  const map = new Map<string, { chunk: ScoredChunk; rrfScore: number }>();

  for (let i = 0; i < vectorResults.length; i++) {
    const chunk = vectorResults[i];
    const existing = map.get(chunk.chunkId);
    if (existing) {
      existing.rrfScore += 1 / (RRF_K + i);
    } else {
      map.set(chunk.chunkId, { chunk, rrfScore: 1 / (RRF_K + i) });
    }
  }

  for (let i = 0; i < lexicalResults.length; i++) {
    const chunk = lexicalResults[i];
    const existing = map.get(chunk.chunkId);
    if (existing) {
      existing.rrfScore += 1 / (RRF_K + i);
    } else {
      map.set(chunk.chunkId, { chunk, rrfScore: 1 / (RRF_K + i) });
    }
  }

  const results: ScoredChunk[] = [];

  map.forEach(({ chunk, rrfScore }) => {
    const tier = chunk.sourceTier as keyof typeof SOURCE_PRIORS;
    const prior = tier in SOURCE_PRIORS ? SOURCE_PRIORS[tier] : 0;
    const identifierBonus = identifierMatchedDocIds.has(chunk.sourceDocumentId)
      ? IDENTIFIER_BONUS
      : 0;
    const finalScore = rrfScore + prior + identifierBonus;
    results.push({ ...chunk, score: finalScore });
  });

  results.sort((a, b) => b.score - a.score);
  return results;
}
