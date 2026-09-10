/**
 * Document + chunk embedding writes for ProgramDocument (Phase 1 semantic RAG).
 *
 * The doc-level vector embeds `title + sageContextNote` — the same text the
 * hybrid search SQL ranks against. Chunk vectors embed body text (when the
 * caller extracted any) at ~512-token granularity via chunkText().
 *
 * Embedding API calls happen BEFORE the transaction; the transaction only
 * writes vectors. Vectors go through raw SQL because Prisma models pgvector
 * columns as Unsupported("vector(768)").
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  embedTextsWithModel,
  toVectorLiteral,
  type EmbeddingUsageContext,
} from "@/lib/ai/embeddings";
import { chunkText, chunkPages, type ChunkWithProvenance } from "./chunking";

export interface EmbedProgramDocumentInput {
  title: string;
  sageContextNote: string | null;
  /** Full extracted body text; chunk embeddings are skipped when absent. */
  text?: string | null;
  /** Page-structured input; when present, enables full provenance (tokenCount/pageNumber/sectionTitle). */
  pages?: { pageNumber: number | null; text: string; extractionMethod?: "text" | "ocr" }[];
  usage?: EmbeddingUsageContext;
}

/**
 * Map ChunkWithProvenance[] to indexed row objects for Prisma inserts.
 * Pure function — safe to test without DB access.
 */
export function buildChunkRows(chunks: ChunkWithProvenance[]) {
  return chunks.map((c, i) => ({
    chunkIndex: i,
    content: c.content,
    tokenCount: c.tokenCount,
    pageNumber: c.pageNumber,
    sectionTitle: c.sectionTitle,
    extractionMethod: c.extractionMethod ?? "unknown",
  }));
}

/** Text embedded at the document level — keep in sync with sage_hybrid_search. */
export function buildDocEmbeddingText(title: string, sageContextNote: string | null): string {
  return sageContextNote ? `${title}\n${sageContextNote}` : title;
}

/**
 * Embed one ProgramDocument: writes the doc-level vector and replaces its
 * DocumentChunk rows (stale chunks are always cleared, even when the new
 * text yields none). Returns the number of chunks written.
 */
export async function embedProgramDocument(
  docId: string,
  input: EmbedProgramDocumentInput,
): Promise<{ chunkCount: number }> {
  const docText = buildDocEmbeddingText(input.title, input.sageContextNote);

  const provChunks: ChunkWithProvenance[] = input.pages
    ? chunkPages(input.pages)
    : (input.text ? chunkText(input.text) : []).map((content) => ({
        content,
        tokenCount: Math.ceil(content.length / 4),
        // Flat text has no reliable physical page location.
        pageNumber: null,
        sectionTitle: null,
        extractionMethod: "text" as const,
      }));
  const rows = buildChunkRows(provChunks);
  const chunkTexts = rows.map((r) => r.content);

  const { vectors, model: activeModel } = await embedTextsWithModel([docText, ...chunkTexts], {
    taskType: "RETRIEVAL_DOCUMENT",
    usage: input.usage ?? { studentId: null, callSite: "sage_embedding_ingest" },
  });
  const [docVector, ...chunkVectors] = vectors;
  if (vectors.length !== rows.length + 1) {
    throw new Error("Embedding response count does not match document and chunks");
  }
  // Validate every vector before replacing the old index.
  const docLiteral = toVectorLiteral(docVector);
  const chunkLiterals = chunkVectors.map(toVectorLiteral);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "visionquest"."ProgramDocument"
      SET embedding = ${docLiteral}::vector(768),
          "embeddingModel" = ${activeModel}
      WHERE id = ${docId}
    `;

    await tx.documentChunk.deleteMany({ where: { documentId: docId } });

    // One parameterized INSERT per bounded batch instead of an INSERT and
    // UPDATE round trip for every chunk. Keep replacement atomic.
    const batchSize = 100;
    for (let start = 0; start < rows.length; start += batchSize) {
      const values = rows.slice(start, start + batchSize).map((row, index) => Prisma.sql`(
        ${randomUUID()}, ${docId}, ${row.chunkIndex}, ${row.content},
        ${chunkLiterals[start + index]}::vector(768), ${activeModel},
        ${row.tokenCount}, ${row.pageNumber}, ${row.sectionTitle}, ${row.extractionMethod}, CURRENT_TIMESTAMP
      )`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "visionquest"."DocumentChunk"
          (id, "documentId", "chunkIndex", content, embedding, "embeddingModel",
           "tokenCount", "pageNumber", "sectionTitle", "extractionMethod", "updatedAt")
        VALUES ${Prisma.join(values)}
      `);
    }
  });

  return { chunkCount: rows.length };
}
