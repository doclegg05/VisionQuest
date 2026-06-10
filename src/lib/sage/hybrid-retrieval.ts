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
import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { embedQuery, toVectorLiteral } from "@/lib/ai/embeddings";
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
 * `npm run sage:rag:harness -- --strict-clean` (Task 9).
 */
export const MAX_COSINE_DISTANCE = 0.55;

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

async function getQueryEmbedding(userMessage: string): Promise<number[]> {
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

  try {
    const rows = await prisma.$queryRaw<HybridSearchRow[]>`
      SELECT * FROM visionquest.sage_hybrid_search(
        ${vectorLiteral}::vector(768),
        ${queryText},
        ${callerRole},
        ${limit}::int
      )
    `;

    return rows
      .filter(
        (row) =>
          row.fts_rank !== null ||
          (row.best_distance !== null && row.best_distance <= MAX_COSINE_DISTANCE),
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
