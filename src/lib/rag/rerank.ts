// src/lib/rag/rerank.ts

import { prisma } from "@/lib/db";
import type { ScoredChunk } from "./types";

/**
 * Standard cosine similarity: dot(a, b) / (|a| * |b|).
 * Returns value in [-1, 1].
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dot / denom;
}

/** Hard duplicate threshold — skip chunks more similar than this to any selected chunk. */
const DUPLICATE_THRESHOLD = 0.9;

/** Trade-off between relevance and diversity. Higher = more relevance. */
const LAMBDA = 0.7;

/**
 * Maximal Marginal Relevance reranking.
 *
 * Iteratively selects chunks that balance high relevance (score) with diversity
 * (low similarity to already-selected chunks).
 *
 * Falls back to simple top-by-score when embeddings are unavailable.
 */
export function rerankWithMMR(
  chunks: ScoredChunk[],
  embeddings: Map<string, number[]>,
  maxResults: number = 8,
): ScoredChunk[] {
  if (chunks.length === 0) return [];

  // Fallback: no embeddings available — return top chunks by score
  if (embeddings.size === 0) {
    return [...chunks]
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  const sorted = [...chunks].sort((a, b) => b.score - a.score);
  const selected: ScoredChunk[] = [];
  const selectedEmbeddings: number[][] = [];
  const remaining = new Set(sorted.map((_, i) => i));

  // Seed with the highest-scoring chunk
  const firstIdx = 0;
  selected.push(sorted[firstIdx]);
  const firstEmb = embeddings.get(sorted[firstIdx].chunkId);
  if (firstEmb) selectedEmbeddings.push(firstEmb);
  remaining.delete(firstIdx);

  while (selected.length < maxResults && remaining.size > 0) {
    let bestIdx = -1;
    let bestMMR = -Infinity;

    for (const idx of remaining) {
      const candidate = sorted[idx];
      const candidateEmb = embeddings.get(candidate.chunkId);

      // If no embedding for this candidate, skip diversity calculation
      if (!candidateEmb || selectedEmbeddings.length === 0) {
        const mmrScore = LAMBDA * candidate.score;
        if (mmrScore > bestMMR) {
          bestMMR = mmrScore;
          bestIdx = idx;
        }
        continue;
      }

      // Compute max similarity to any already-selected chunk
      let maxSim = -Infinity;
      for (const selEmb of selectedEmbeddings) {
        const sim = cosineSimilarity(candidateEmb, selEmb);
        if (sim > maxSim) maxSim = sim;
      }

      // Hard duplicate filter
      if (maxSim > DUPLICATE_THRESHOLD) continue;

      const mmrScore = LAMBDA * candidate.score - (1 - LAMBDA) * maxSim;
      if (mmrScore > bestMMR) {
        bestMMR = mmrScore;
        bestIdx = idx;
      }
    }

    // No viable candidates left (all filtered as duplicates)
    if (bestIdx === -1) break;

    selected.push(sorted[bestIdx]);
    const emb = embeddings.get(sorted[bestIdx].chunkId);
    if (emb) selectedEmbeddings.push(emb);
    remaining.delete(bestIdx);
  }

  return selected;
}

/** Score multiplier applied to neighbor chunks. */
const NEIGHBOR_SCORE_FACTOR = 0.8;

/**
 * Expand selected chunks with hierarchy-aware neighbors.
 *
 * For chunks with a parentId, fetches sibling chunks (same parent).
 * For prose chunks without a parent, fetches adjacent chunks (chunkIndex +/- 1)
 * from the same source document.
 *
 * Neighbors receive a slightly reduced score (parent's score * 0.8).
 */
export async function expandNeighbors(
  selectedChunks: ScoredChunk[],
): Promise<ScoredChunk[]> {
  if (selectedChunks.length === 0) return [];

  const existingIds = new Set(selectedChunks.map((c) => c.chunkId));
  const neighbors: ScoredChunk[] = [];

  // Batch queries: collect parentIds and adjacent-index lookups
  const parentIds = new Set<string>();
  const adjacentLookups: Array<{
    sourceDocumentId: string;
    chunkIndex: number;
    parentScore: number;
  }> = [];

  for (const chunk of selectedChunks) {
    if (chunk.parentId) {
      parentIds.add(chunk.parentId);
    } else if (chunk.chunkType === "prose" || chunk.chunkType === null) {
      adjacentLookups.push({
        sourceDocumentId: chunk.sourceDocumentId,
        chunkIndex: chunk.chunkIndex - 1,
        parentScore: chunk.score,
      });
      adjacentLookups.push({
        sourceDocumentId: chunk.sourceDocumentId,
        chunkIndex: chunk.chunkIndex + 1,
        parentScore: chunk.score,
      });
    }
  }

  // Build a map of parentId -> parent chunk score for neighbor scoring
  const parentScoreMap = new Map<string, number>();
  for (const chunk of selectedChunks) {
    if (chunk.parentId) {
      const existing = parentScoreMap.get(chunk.parentId) ?? 0;
      if (chunk.score > existing) {
        parentScoreMap.set(chunk.parentId, chunk.score);
      }
    }
  }

  // Fetch sibling chunks (same parentId)
  if (parentIds.size > 0) {
    const siblings = await prisma.contentChunk.findMany({
      where: {
        parentId: { in: [...parentIds] },
        isActive: true,
      },
      include: { sourceDocument: true },
    });

    for (const sib of siblings) {
      if (existingIds.has(sib.id)) continue;
      existingIds.add(sib.id);

      const parentScore = parentScoreMap.get(sib.parentId!) ?? 0;
      neighbors.push({
        chunkId: sib.id,
        sourceDocumentId: sib.sourceDocumentId,
        sourceDocTitle: sib.sourceDocument.title,
        sourceTier: sib.sourceDocument.sourceTier,
        sourceWeight: sib.sourceDocument.sourceWeight,
        content: sib.content,
        breadcrumb: sib.breadcrumb,
        sectionHeading: sib.sectionHeading,
        pageNumber: sib.pageNumber,
        chunkIndex: sib.chunkIndex,
        chunkType: sib.chunkType,
        parentId: sib.parentId,
        score: parentScore * NEIGHBOR_SCORE_FACTOR,
      });
    }
  }

  // Fetch adjacent chunks (chunkIndex +/- 1, same document)
  if (adjacentLookups.length > 0) {
    // Group by sourceDocumentId for efficient querying
    const lookupsByDoc = new Map<
      string,
      Array<{ chunkIndex: number; parentScore: number }>
    >();
    for (const lookup of adjacentLookups) {
      if (lookup.chunkIndex < 0) continue;
      const existing = lookupsByDoc.get(lookup.sourceDocumentId) ?? [];
      existing.push({
        chunkIndex: lookup.chunkIndex,
        parentScore: lookup.parentScore,
      });
      lookupsByDoc.set(lookup.sourceDocumentId, existing);
    }

    for (const [docId, lookups] of lookupsByDoc) {
      const indices = lookups.map((l) => l.chunkIndex);
      const adjacentChunks = await prisma.contentChunk.findMany({
        where: {
          sourceDocumentId: docId,
          chunkIndex: { in: indices },
          isActive: true,
        },
        include: { sourceDocument: true },
      });

      // Map chunkIndex -> max parent score
      const indexScoreMap = new Map<number, number>();
      for (const l of lookups) {
        const existing = indexScoreMap.get(l.chunkIndex) ?? 0;
        if (l.parentScore > existing) {
          indexScoreMap.set(l.chunkIndex, l.parentScore);
        }
      }

      for (const adj of adjacentChunks) {
        if (existingIds.has(adj.id)) continue;
        existingIds.add(adj.id);

        const parentScore = indexScoreMap.get(adj.chunkIndex) ?? 0;
        neighbors.push({
          chunkId: adj.id,
          sourceDocumentId: adj.sourceDocumentId,
          sourceDocTitle: adj.sourceDocument.title,
          sourceTier: adj.sourceDocument.sourceTier,
          sourceWeight: adj.sourceDocument.sourceWeight,
          content: adj.content,
          breadcrumb: adj.breadcrumb,
          sectionHeading: adj.sectionHeading,
          pageNumber: adj.pageNumber,
          chunkIndex: adj.chunkIndex,
          chunkType: adj.chunkType,
          parentId: adj.parentId,
          score: parentScore * NEIGHBOR_SCORE_FACTOR,
        });
      }
    }
  }

  // Combine and re-sort by score descending
  const combined = [...selectedChunks, ...neighbors];
  combined.sort((a, b) => b.score - a.score);
  return combined;
}
