/**
 * Hybrid semantic retrieval over ProgramDocument (Phase 1 semantic RAG).
 *
 * Embeds the user message (gemini-embedding-001, cached 300s) and calls
 * visionquest.sage_hybrid_search(), which fuses pgvector cosine similarity
 * with Postgres full-text search via reciprocal rank fusion (k=50).
 *
 * Returns null on ANY failure (embedding service, SQL) so the caller can fall
 * back to the keyword-scoring path — hybrid retrieval must never take Sage
 * chat down with it.
 */

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { embedQuery, toVectorLiteral } from "@/lib/ai/embeddings";
import { getActiveEmbeddingModel } from "@/lib/ai/embedding-provider";
import { tokenizeForRetrieval } from "./retrieval-tokens";

export interface HybridDocResult {
  id: string;
  title: string;
  sageContextNote: string | null;
  score: number;
  semanticRank: number | null;
  ftsRank: number | null;
  bestDistance: number | null;
}

/**
 * Clean-retrieval cutoff: semantic-only matches (no FTS hit) farther than
 * this cosine distance are dropped as noise. Tuned against
 * `npm run sage:rag:harness -- --strict-clean` (Task 9); overridable via
 * SAGE_RAG_MAX_DISTANCE for operational tuning without a deploy.
 */
const DEFAULT_MAX_COSINE_DISTANCE = 0.55;

export function getMaxCosineDistance(): number {
  const raw = Number.parseFloat(process.env.SAGE_RAG_MAX_DISTANCE ?? "");
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_MAX_COSINE_DISTANCE;
}

/**
 * Relative score cutoff: entries scoring below this fraction of the top
 * result's RRF score are dropped. A doc that hits both search legs scores
 * roughly 2x a single-leg match, so this separates "the answer plus its
 * genuine peers" from plausible-but-off-target fillers. Overridable via
 * SAGE_RAG_MIN_SCORE_RATIO.
 */
const DEFAULT_MIN_SCORE_RATIO = 0;

export function getMinScoreRatio(): number {
  const raw = Number.parseFloat(process.env.SAGE_RAG_MIN_SCORE_RATIO ?? "");
  return Number.isFinite(raw) && raw >= 0 && raw < 1 ? raw : DEFAULT_MIN_SCORE_RATIO;
}

/**
 * Relative distance margin: entries whose best cosine distance exceeds the
 * closest entry's distance by more than this are dropped, even when they hit
 * the full-text leg. RRF treats rank positions as equal-quality, so weak
 * shared-word FTS matches ("SPOKES", "services") otherwise score nearly as
 * high as the true answer; the embedding distance separates them cleanly.
 * Disabled when 0. Overridable via SAGE_RAG_DISTANCE_MARGIN.
 *
 * 0.04 tuned via harness sweep (2026-06-10): margins ≤0.035 break the
 * 100% top-3 gate; ≥0.045 lets fillers back in (clean 18/20 at 0.04).
 */
const DEFAULT_DISTANCE_MARGIN = 0.04;

export function getDistanceMargin(): number {
  const raw = Number.parseFloat(process.env.SAGE_RAG_DISTANCE_MARGIN ?? "");
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_DISTANCE_MARGIN;
}

/**
 * Abstention floor (Sub-project B): when even the closest surviving match's
 * cosine distance exceeds this, hybridSearchDocuments returns [] (no docs)
 * rather than surfacing a weak/off-topic result for an off-topic query. The
 * default of 1 leaves the gate effectively OFF — genuine matches sit well
 * below 1 — so behavior is unchanged until an operator sets
 * SAGE_RAG_ABSTAIN_DISTANCE to a calibrated value (see
 * scripts/sage-rag-calibrate-abstention.mjs). Valid range (0, 2].
 */
const DEFAULT_ABSTENTION_DISTANCE = 1;

export function getAbstentionDistance(): number {
  const raw = Number.parseFloat(process.env.SAGE_RAG_ABSTAIN_DISTANCE ?? "");
  return Number.isFinite(raw) && raw > 0 && raw <= 2 ? raw : DEFAULT_ABSTENTION_DISTANCE;
}

const QUERY_EMBED_CACHE_TTL_SECONDS = 300;

interface HybridSearchRow {
  id: string;
  title: string;
  sageContextNote: string | null;
  score: number;
  semantic_rank: number | null;
  fts_rank: number | null;
  best_distance: number | null;
}

/**
 * Build a websearch_to_tsquery input from message keywords, OR-joined so a
 * single missing word doesn't blank the whole full-text leg (websearch
 * semantics default to AND).
 */
export function buildWebsearchQuery(userMessage: string): string {
  const tokens = [...new Set(tokenizeForRetrieval(userMessage, 3))];
  return tokens.join(" OR ");
}

export async function getQueryEmbedding(userMessage: string): Promise<number[]> {
  const digest = createHash("sha1").update(userMessage).digest("hex");
  return cached(`sage:qe:${digest}`, QUERY_EMBED_CACHE_TTL_SECONDS, () =>
    embedQuery(userMessage),
  );
}

/**
 * Run hybrid search for the user's message. Returns up to `limit` documents
 * ordered by fused RRF score, or null when the hybrid path is unavailable
 * (caller should fall back to keyword scoring).
 */
export async function hybridSearchDocuments(
  userMessage: string,
  callerRole: "student" | "staff",
  limit: number,
): Promise<HybridDocResult[] | null> {
  let vectorLiteral: string;
  try {
    vectorLiteral = toVectorLiteral(await getQueryEmbedding(userMessage));
  } catch (error) {
    logger.warn("Hybrid retrieval: query embedding failed, falling back to keyword scoring", {
      error: String(error),
    });
    return null;
  }

  const queryText = buildWebsearchQuery(userMessage);
  const queryModel = await getActiveEmbeddingModel();

  try {
    const rows = await prisma.$queryRaw<HybridSearchRow[]>`
      SELECT * FROM visionquest.sage_hybrid_search(
        ${vectorLiteral}::vector(768),
        ${queryText},
        ${callerRole},
        ${queryModel},
        ${limit}::int
      )
    `;

    const filtered = rows.filter(
      (row) =>
        row.fts_rank !== null ||
        (row.best_distance !== null && row.best_distance <= getMaxCosineDistance()),
    );

    const distances = filtered
      .map((row) => row.best_distance)
      .filter((distance): distance is number => distance !== null);
    const closestDistance = distances.length > 0 ? Math.min(...distances) : null;

    // Abstention gate (Sub-project B): when even the closest surviving match is
    // farther than the absolute floor, return nothing rather than surfacing a
    // weak/off-topic doc. Best-match-only — abstains only when EVERYTHING is
    // far; FTS-only rows (no distance) never trigger it. Off by default
    // (floor 1); armed via SAGE_RAG_ABSTAIN_DISTANCE once calibrated.
    if (closestDistance !== null && closestDistance > getAbstentionDistance()) {
      return [];
    }

    // Rows arrive ordered by fused score; apply relative cutoffs against the
    // best surviving entry.
    const topScore = filtered[0]?.score ?? 0;
    const minScore = topScore * getMinScoreRatio();

    const margin = getDistanceMargin();
    const maxAllowedDistance =
      margin > 0 && closestDistance !== null ? closestDistance + margin : Infinity;

    return filtered
      .filter(
        (row) =>
          row.score >= minScore &&
          (row.best_distance === null || row.best_distance <= maxAllowedDistance),
      )
      .map((row) => ({
        id: row.id,
        title: row.title,
        sageContextNote: row.sageContextNote,
        score: row.score,
        semanticRank: row.semantic_rank,
        ftsRank: row.fts_rank,
        bestDistance: row.best_distance,
      }));
  } catch (error) {
    logger.warn("Hybrid retrieval: SQL search failed, falling back to keyword scoring", {
      error: String(error),
    });
    return null;
  }
}

export interface ChunkPassage {
  documentId: string;
  content: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  distance: number;
}

interface BestChunkRow {
  documentId: string;
  content: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  distance: number;
}

/**
 * For already-ranked documents, fetch the `perDoc` closest chunks each by
 * cosine distance to the query embedding. RLS audience-filters chunk reads
 * (DocumentChunk read policy joins ProgramDocument.audience). Returns an empty
 * Map on any failure so the caller falls back to summary injection.
 */
export async function getBestChunks(
  documentIds: string[],
  userMessage: string,
  perDoc: number,
): Promise<Map<string, ChunkPassage[]>> {
  if (documentIds.length === 0) return new Map();
  try {
    const vectorLiteral = toVectorLiteral(await getQueryEmbedding(userMessage));
    const queryModel = await getActiveEmbeddingModel();
    const rows = await prisma.$queryRaw<BestChunkRow[]>`
      SELECT "documentId", "content", "pageNumber", "sectionTitle", distance
      FROM (
        SELECT c."documentId",
               c."content",
               c."pageNumber",
               c."sectionTitle",
               (c."embedding" <=> ${vectorLiteral}::vector(768)) AS distance,
               row_number() OVER (
                 PARTITION BY c."documentId"
                 ORDER BY c."embedding" <=> ${vectorLiteral}::vector(768)
               ) AS rn
        FROM "visionquest"."DocumentChunk" c
        WHERE c."documentId" IN (${Prisma.join(documentIds)})
          AND c."embedding" IS NOT NULL
          AND c."embeddingModel" = ${queryModel}
      ) ranked
      WHERE rn <= ${perDoc}
      ORDER BY "documentId", distance
    `;
    const map = new Map<string, ChunkPassage[]>();
    for (const r of rows) {
      const list = map.get(r.documentId) ?? [];
      list.push(r);
      map.set(r.documentId, list);
    }
    return map;
  } catch (error) {
    logger.warn("getBestChunks failed; falling back to summary injection", {
      error: String(error),
    });
    return new Map();
  }
}
