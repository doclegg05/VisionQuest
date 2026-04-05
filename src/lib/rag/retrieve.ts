// src/lib/rag/retrieve.ts

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { classifyQuery } from "./query-classifier";
import { shouldRewrite, rewriteQuery } from "./query-rewriter";
import { getEmbeddingProvider } from "./embedding-provider";
import { fuseResults } from "./fusion";
import { rerankWithMMR, expandNeighbors } from "./rerank";
import { assembleContext } from "./context-assembler";
import { logRetrieval } from "./diagnostics";
import type {
  QueryType,
  ScoredChunk,
  ConfidenceResult,
  ConfidenceLevel,
  RetrievalResult,
  RetrievalDiagnostic,
} from "./types";
import { CONFIDENCE_THRESHOLDS } from "./types";

// ---------------------------------------------------------------------------
// Session context shape
// ---------------------------------------------------------------------------

interface SessionContext {
  userId: string;
  role: string;
  teacherId?: string;
}

// ---------------------------------------------------------------------------
// Source-type filter by query type
// ---------------------------------------------------------------------------

function sourceTypesForQuery(
  queryType: QueryType,
  session: SessionContext,
): string[] {
  switch (queryType) {
    case "app_navigation":
      return ["app_knowledge"];
    case "external_platform":
      return ["program_doc", "platform_guide"];
    case "document":
    case "mixed":
    default: {
      const types = ["program_doc", "platform_guide", "app_knowledge"];
      // Students can see uploaded docs only from their teacher
      if (session.role === "student" && session.teacherId) {
        types.push("uploaded");
      }
      // Teachers see all uploaded docs
      if (session.role === "teacher") {
        types.push("uploaded");
      }
      return types;
    }
  }
}

// ---------------------------------------------------------------------------
// Vector search
// ---------------------------------------------------------------------------

interface RawSearchRow {
  chunkId: string;
  sourceDocumentId: string;
  sourceDocTitle: string;
  sourceTier: string;
  sourceWeight: number;
  content: string;
  breadcrumb: string;
  sectionHeading: string | null;
  pageNumber: number | null;
  chunkIndex: number;
  chunkType: string | null;
  parentId: string | null;
  score: number;
}

async function vectorSearch(
  queryEmbedding: number[],
  queryType: QueryType,
  session: SessionContext,
): Promise<ScoredChunk[]> {
  const sourceTypes = sourceTypesForQuery(queryType, session);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  // Build the uploaded-doc visibility clause for students
  let uploadedClause = "";
  const params: unknown[] = [embeddingStr, sourceTypes];

  if (
    session.role === "student" &&
    session.teacherId &&
    sourceTypes.includes("uploaded")
  ) {
    uploadedClause = `AND (sd."sourceType" != 'uploaded' OR sd."uploadedBy" = $3)`;
    params.push(session.teacherId);
  }

  const sql = `
    SELECT c.id as "chunkId", c."sourceDocumentId", sd.title as "sourceDocTitle",
      sd."sourceTier", sd."sourceWeight", c.content, c.breadcrumb,
      c."sectionHeading", c."pageNumber", c."chunkIndex", c."chunkType", c."parentId",
      1 - (c.embedding <=> $1::vector) as score
    FROM "visionquest"."ContentChunk" c
    JOIN "visionquest"."SourceDocument" sd ON c."sourceDocumentId" = sd.id
    WHERE c."isActive" = true AND sd."isActive" = true
      AND sd."sourceType" = ANY($2::text[])
      ${uploadedClause}
    ORDER BY c.embedding <=> $1::vector
    LIMIT 20
  `;

  const rows = await prisma.$queryRawUnsafe<RawSearchRow[]>(sql, ...params);
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

// ---------------------------------------------------------------------------
// Lexical search
// ---------------------------------------------------------------------------

async function lexicalSearch(
  query: string,
  queryType: QueryType,
  session: SessionContext,
): Promise<ScoredChunk[]> {
  const sourceTypes = sourceTypesForQuery(queryType, session);

  let uploadedClause = "";
  const params: unknown[] = [query, sourceTypes];

  if (
    session.role === "student" &&
    session.teacherId &&
    sourceTypes.includes("uploaded")
  ) {
    uploadedClause = `AND (sd."sourceType" != 'uploaded' OR sd."uploadedBy" = $3)`;
    params.push(session.teacherId);
  }

  const sql = `
    SELECT c.id as "chunkId", c."sourceDocumentId", sd.title as "sourceDocTitle",
      sd."sourceTier", sd."sourceWeight", c.content, c.breadcrumb,
      c."sectionHeading", c."pageNumber", c."chunkIndex", c."chunkType", c."parentId",
      ts_rank_cd(c.search_body, plainto_tsquery('english', $1)) as score
    FROM "visionquest"."ContentChunk" c
    JOIN "visionquest"."SourceDocument" sd ON c."sourceDocumentId" = sd.id
    WHERE c."isActive" = true AND sd."isActive" = true
      AND c.search_body @@ plainto_tsquery('english', $1)
      AND sd."sourceType" = ANY($2::text[])
      ${uploadedClause}
    ORDER BY score DESC
    LIMIT 20
  `;

  const rows = await prisma.$queryRawUnsafe<RawSearchRow[]>(sql, ...params);
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

// ---------------------------------------------------------------------------
// Identifier search
// ---------------------------------------------------------------------------

async function identifierSearch(entities: string[]): Promise<Set<string>> {
  if (entities.length === 0) return new Set();

  const normalizedEntities = entities.map((e) => e.toLowerCase().trim());

  const docs = await prisma.sourceDocument.findMany({
    where: {
      isActive: true,
      OR: [
        { certificationId: { in: normalizedEntities } },
        { platformId: { in: normalizedEntities } },
        { formCode: { in: normalizedEntities } },
        { aliases: { hasSome: normalizedEntities } },
      ],
    },
    select: { id: true },
  });

  return new Set(docs.map((d) => d.id));
}

// ---------------------------------------------------------------------------
// Confidence check
// ---------------------------------------------------------------------------

function checkConfidence(
  results: ScoredChunk[],
  identifierDocIds: Set<string>,
): ConfidenceResult {
  const topScore = results[0]?.score ?? 0;
  const thirdScore = results[2]?.score ?? 0;
  const scoreMargin = topScore - thirdScore;
  const hasIdentifierMatch = results
    .slice(0, 3)
    .some((r) => identifierDocIds.has(r.sourceDocumentId));
  const topTierIsCanonical = results
    .slice(0, 3)
    .every((r) => r.sourceTier === "canonical" || r.sourceTier === "curated");

  let level: ConfidenceLevel;
  if (
    topScore > CONFIDENCE_THRESHOLDS.high &&
    (hasIdentifierMatch || topTierIsCanonical)
  ) {
    level = "high";
  } else if (
    topScore > CONFIDENCE_THRESHOLDS.medium &&
    scoreMargin > CONFIDENCE_THRESHOLDS.marginForMedium
  ) {
    level = "medium";
  } else if (topScore > CONFIDENCE_THRESHOLDS.low) {
    level = "low";
  } else {
    level = "none";
  }

  return { level, topScore, scoreMargin, hasIdentifierMatch, topTierIsCanonical };
}

// ---------------------------------------------------------------------------
// Empty / fallback result builder
// ---------------------------------------------------------------------------

function emptyResult(
  queryType: QueryType,
  rewrittenQuery: string | null,
  resolvedEntities: string[],
): RetrievalResult {
  return {
    chunks: [],
    context: null,
    confidence: {
      level: "none",
      topScore: 0,
      scoreMargin: 0,
      hasIdentifierMatch: false,
      topTierIsCanonical: false,
    },
    queryType,
    rewrittenQuery,
    resolvedEntities,
    fallbackUsed: true,
  };
}

// ---------------------------------------------------------------------------
// Main retrieval pipeline
// ---------------------------------------------------------------------------

export async function retrieve(
  userMessage: string,
  conversationId: string,
  recentMessages: { role: string; content: string }[],
  sessionContext: SessionContext,
): Promise<RetrievalResult> {
  const startTime = Date.now();

  try {
    // 1. Classify query
    let queryType = classifyQuery(userMessage);

    // 2. Early return for non-RAG queries
    if (queryType === "conversation_memory" || queryType === "personal_status") {
      return emptyResult(queryType, null, []);
    }

    // 3. Conditional rewrite
    let searchQuery = userMessage;
    let rewrittenQuery: string | null = null;
    let resolvedEntities: string[] = [];
    let rewriteSkipped = true;

    if (shouldRewrite(userMessage)) {
      const rewritten = await rewriteQuery(
        userMessage,
        recentMessages,
        sessionContext.userId,
      );

      if (!rewritten.skipRewrite) {
        searchQuery = rewritten.standaloneQuery;
        rewrittenQuery = rewritten.standaloneQuery;
        queryType = rewritten.queryType;
        rewriteSkipped = false;
      }

      resolvedEntities = rewritten.resolvedEntities;
    }

    // 4. Embed query
    const provider = getEmbeddingProvider();
    const [queryEmbedding] = await provider.embed([searchQuery]);

    // 5. Parallel search
    const [vectorResults, lexicalResults, identifierDocIds] = await Promise.all([
      vectorSearch(queryEmbedding, queryType, sessionContext),
      lexicalSearch(searchQuery, queryType, sessionContext),
      identifierSearch(resolvedEntities),
    ]);

    // 6. Fuse
    const fusedResults = fuseResults(
      vectorResults,
      lexicalResults,
      identifierDocIds,
    );

    // 7. Confidence check
    const confidence = checkConfidence(fusedResults, identifierDocIds);

    if (confidence.level === "none") {
      logDiagnostic({
        conversationId,
        userMessage,
        queryType,
        rewrittenQuery,
        rewriteSkipped,
        resolvedEntities,
        vectorResults,
        lexicalResults,
        identifierDocIds,
        fusedResults,
        finalChunks: [],
        fallbackUsed: true,
        confidence,
        startTime,
      });

      return emptyResult(queryType, rewrittenQuery, resolvedEntities);
    }

    // 8. Rerank — build embeddings map for MMR
    const embeddingsMap = new Map<string, number[]>();
    const chunkIdsToEmbed = fusedResults.map((c) => c.chunkId);
    const chunkTexts = fusedResults.map((c) => c.content);

    if (chunkTexts.length > 0) {
      const chunkEmbeddings = await provider.embed(chunkTexts);
      for (let i = 0; i < chunkIdsToEmbed.length; i++) {
        embeddingsMap.set(chunkIdsToEmbed[i], chunkEmbeddings[i]);
      }
    }

    const reranked = rerankWithMMR(fusedResults, embeddingsMap, 8);

    // 9. Expand neighbors
    const expanded = await expandNeighbors(reranked);

    // 10. Assemble context
    const context = assembleContext(expanded, confidence, queryType);

    // 11. Log diagnostics
    logDiagnostic({
      conversationId,
      userMessage,
      queryType,
      rewrittenQuery,
      rewriteSkipped,
      resolvedEntities,
      vectorResults,
      lexicalResults,
      identifierDocIds,
      fusedResults,
      finalChunks: expanded,
      fallbackUsed: false,
      confidence,
      startTime,
    });

    // 12. Return
    return {
      chunks: expanded,
      context,
      confidence,
      queryType,
      rewrittenQuery,
      resolvedEntities,
      fallbackUsed: false,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("rag:retrieve:pipeline-error", {
      conversationId,
      userMessage,
      error: message,
    });

    return emptyResult(classifyQuery(userMessage), null, []);
  }
}

// ---------------------------------------------------------------------------
// Diagnostic logging helper
// ---------------------------------------------------------------------------

interface DiagnosticInput {
  conversationId: string;
  userMessage: string;
  queryType: QueryType;
  rewrittenQuery: string | null;
  rewriteSkipped: boolean;
  resolvedEntities: string[];
  vectorResults: ScoredChunk[];
  lexicalResults: ScoredChunk[];
  identifierDocIds: Set<string>;
  fusedResults: ScoredChunk[];
  finalChunks: ScoredChunk[];
  fallbackUsed: boolean;
  confidence: ConfidenceResult;
  startTime: number;
}

function logDiagnostic(input: DiagnosticInput): void {
  const uploadedDocsInfluenced = input.finalChunks.some(
    (c) => c.sourceTier === "user_uploaded",
  );

  const diagnostic: RetrievalDiagnostic = {
    conversationId: input.conversationId,
    userMessage: input.userMessage,
    queryType: input.queryType,
    rewrittenQuery: input.rewrittenQuery,
    rewriteSkipped: input.rewriteSkipped,
    resolvedEntities: input.resolvedEntities,
    vectorTopK: input.vectorResults.slice(0, 5).map((c) => ({
      chunkId: c.chunkId,
      score: c.score,
    })),
    lexicalTopK: input.lexicalResults.slice(0, 5).map((c) => ({
      chunkId: c.chunkId,
      score: c.score,
    })),
    identifierMatches: [...input.identifierDocIds],
    fusedTopK: input.fusedResults.slice(0, 5).map((c) => ({
      chunkId: c.chunkId,
      score: c.score,
    })),
    finalIncluded: input.finalChunks.map((c) => ({
      chunkId: c.chunkId,
      sourceDocTitle: c.sourceDocTitle,
      sourceTier: c.sourceTier,
    })),
    uploadedDocsInfluenced,
    fallbackUsed: input.fallbackUsed,
    confidenceScore: input.confidence.topScore,
    latencyMs: Date.now() - input.startTime,
    timestamp: new Date(),
  };

  logRetrieval(diagnostic);
}
