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
  storageKey: string;
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
 *
 * 0.85 tuned 2026-07-10 against sage-rag-eval.json (clean top-3 10/20 → 15/20
 * combined with the 0.02 margin below): dual-leg peers sit at ratio ≥ 0.92,
 * single-leg fillers at ≈ 0.5, so 0.85 splits the two populations with slack.
 */
const DEFAULT_MIN_SCORE_RATIO = 0.85;

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
 * 0.04 tuned via harness sweep (2026-06-10) against the then-current fixture;
 * re-tuned to 0.02 on 2026-07-10 against the grown sage-rag-eval.json
 * (close-confusion cases): trailing sibling docs sit 0.02–0.05 farther than
 * the answer, genuine multi-doc peers within ~0.015. The empty-result
 * fallback below keeps a keyword-strong lone winner retrievable, which the
 * 2026-06-10 sweep's tighter margins lacked.
 */
const DEFAULT_DISTANCE_MARGIN = 0.02;

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
  storage_key: string;
  sageContextNote: string | null;
  score: number;
  semantic_rank: number | null;
  fts_rank: number | null;
  best_distance: number | null;
}

/**
 * RRF scores are sums of 1/(k+rank), so two docs holding mirrored ranks on the
 * two legs (e.g. sem 1/fts 2 vs sem 2/fts 1) tie exactly. Treat differences
 * below this as a tie and break by embedding distance instead.
 */
const SCORE_TIE_EPSILON = 1e-9;

/**
 * The corpus carries the same form at multiple storage paths (e.g. the DoHS
 * release exists under both orientation/ and forms/). Collapse retrieval rows
 * on this normalized title key so a duplicate can't occupy a second slot.
 */
function normalizeTitleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "");
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

  // Fetch beyond the caller's limit so rows removed by dedupe and the relative
  // cutoffs below can backfill from cut-survivors instead of shrinking the set.
  const fetchLimit = limit * 2 + 2;

  try {
    const rows = await prisma.$queryRaw<HybridSearchRow[]>`
      SELECT * FROM visionquest.sage_hybrid_search(
        ${vectorLiteral}::vector(768),
        ${queryText},
        ${callerRole},
        ${queryModel},
        ${fetchLimit}::int
      )
    `;

    const filtered = rows.filter(
      (row) =>
        row.fts_rank !== null ||
        (row.best_distance !== null && row.best_distance <= getMaxCosineDistance()),
    );

    // Rows arrive ordered by fused score; exact RRF ties (mirrored leg ranks)
    // are re-broken by embedding distance so the semantically closer doc wins.
    const ordered = [...filtered].sort((a, b) => {
      if (Math.abs(b.score - a.score) > SCORE_TIE_EPSILON) return b.score - a.score;
      return (a.best_distance ?? Infinity) - (b.best_distance ?? Infinity);
    });

    const seenTitles = new Set<string>();
    const deduped = ordered.filter((row) => {
      const key = normalizeTitleKey(row.title);
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    });

    const distances = deduped
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

    // Relative cutoffs against the best surviving entry. When the cutoffs
    // disagree so hard that nothing survives (the fused winner sits outside
    // the margin anchored on a semantically-closer row AND that closer row is
    // too weak on score), fall back to the fused winner alone rather than
    // returning nothing — the cutoffs exist to trim trailing noise, not to
    // veto the best match.
    const topScore = deduped[0]?.score ?? 0;
    const minScore = topScore * getMinScoreRatio();

    const margin = getDistanceMargin();
    const maxAllowedDistance =
      margin > 0 && closestDistance !== null ? closestDistance + margin : Infinity;

    const trimmed = deduped.filter(
      (row) =>
        row.score >= minScore &&
        (row.best_distance === null || row.best_distance <= maxAllowedDistance),
    );
    const surviving = trimmed.length > 0 ? trimmed : deduped.slice(0, 1);

    return surviving
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        title: row.title,
        storageKey: row.storage_key,
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
    const queryText = buildWebsearchQuery(userMessage);
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
                 ORDER BY
                   CASE WHEN ${queryText} <> '' THEN
                     ts_rank_cd(c.fts, websearch_to_tsquery('english', ${queryText}))
                   ELSE 0 END DESC,
                   c."embedding" <=> ${vectorLiteral}::vector(768)
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
