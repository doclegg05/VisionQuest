// ── Query types ─────────────────────────────────────────────────────────────

export type QueryType =
  | "document"
  | "app_navigation"
  | "external_platform"
  | "conversation_memory"
  | "personal_status"
  | "mixed";

// ── Query rewriting ─────────────────────────────────────────────────────────

export interface RewrittenQuery {
  standaloneQuery: string;
  resolvedEntities: string[];
  queryType: QueryType;
  skipRewrite: boolean;
}

// ── Confidence ──────────────────────────────────────────────────────────────

export type ConfidenceLevel = "high" | "medium" | "low" | "none";

export interface ConfidenceResult {
  level: ConfidenceLevel;
  topScore: number;
  scoreMargin: number;
  hasIdentifierMatch: boolean;
  topTierIsCanonical: boolean;
}

// ── Retrieval ───────────────────────────────────────────────────────────────

export interface ScoredChunk {
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

export interface Citation {
  index: number;
  sourceDocTitle: string;
  pageNumber: number | null;
  sectionHeading: string | null;
  sourceTier: string;
}

export interface RetrievalResult {
  chunks: ScoredChunk[];
  confidence: ConfidenceResult;
  queryType: QueryType;
  rewrittenQuery: string | null;
  resolvedEntities: string[];
  fallbackUsed: boolean;
}

export interface AssembledContext {
  referenceBlock: string;
  citations: Citation[];
  confidence: ConfidenceLevel;
  chunksIncluded: number;
  tokenEstimate: number;
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

export interface RetrievalDiagnostic {
  conversationId: string;
  userMessage: string;
  queryType: QueryType;
  rewrittenQuery: string | null;
  rewriteSkipped: boolean;
  resolvedEntities: string[];
  vectorTopK: { chunkId: string; score: number }[];
  lexicalTopK: { chunkId: string; score: number }[];
  identifierMatches: string[];
  fusedTopK: { chunkId: string; score: number }[];
  finalIncluded: {
    chunkId: string;
    sourceDocTitle: string;
    sourceTier: string;
  }[];
  uploadedDocsInfluenced: boolean;
  fallbackUsed: boolean;
  confidenceScore: number;
  latencyMs: number;
  timestamp: Date;
}

// ── Embedding ───────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly name: string;
  readonly version: string;
}

// ── Ingestion ───────────────────────────────────────────────────────────────

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  qualityScore: number;
  ocrUsed: boolean;
}

export interface ExtractedDocument {
  pages: ExtractedPage[];
  title: string;
  mimeType: string;
}

export interface ChunkData {
  content: string;
  breadcrumb: string;
  sectionHeading: string | null;
  pageNumber: number | null;
  charStart: number | null;
  charEnd: number | null;
  chunkType: string | null;
  tokenCount: number;
  ocrUsed: boolean;
  parentIndex: number | null;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const PARSER_VERSION = "v1";
export const CHUNKING_VERSION = "v1";
export const EMBEDDING_VERSION = "v1";

export const SOURCE_PRIORS = {
  canonical: 0.03,
  curated: 0.015,
  user_uploaded: 0.0,
} as const;

export const IDENTIFIER_BONUS = 0.02;

export const RRF_K = 60;

export const TIER_CAPS = {
  canonical: { perQuery: 4, perDocument: 2 },
  curated: { perQuery: 2, perDocument: 2 },
  user_uploaded: { perQuery: 1, perDocument: 1 },
} as const;

export const CONFIDENCE_THRESHOLDS = {
  high: 0.08,
  medium: 0.05,
  low: 0.03,
  marginForMedium: 0.02,
} as const;

export const MAX_RAG_TOKENS = 1500;
