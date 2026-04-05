// src/lib/rag/types.ts

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly name: string;
  readonly version: string;
}
