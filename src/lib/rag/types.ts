// src/lib/rag/types.ts

export type QueryType =
  | "document"
  | "app_navigation"
  | "external_platform"
  | "conversation_memory"
  | "personal_status"
  | "mixed";

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly name: string;
  readonly version: string;
}

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

export interface RewrittenQuery {
  standaloneQuery: string;
  resolvedEntities: string[];
  queryType: QueryType;
  skipRewrite: boolean;
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

export const SOURCE_PRIORS = { canonical: 0.03, curated: 0.015, user_uploaded: 0.0 } as const;
export const IDENTIFIER_BONUS = 0.02;
export const RRF_K = 60;
