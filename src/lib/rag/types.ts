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
