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

import { prisma } from "@/lib/db";
import {
  embedTexts,
  toVectorLiteral,
  type EmbeddingUsageContext,
} from "@/lib/ai/embeddings";
import { chunkText } from "./chunking";

export interface EmbedProgramDocumentInput {
  title: string;
  sageContextNote: string | null;
  /** Full extracted body text; chunk embeddings are skipped when absent. */
  text?: string | null;
  usage?: EmbeddingUsageContext;
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
  const chunks = input.text ? chunkText(input.text) : [];

  const vectors = await embedTexts([docText, ...chunks], {
    taskType: "RETRIEVAL_DOCUMENT",
    usage: input.usage ?? { studentId: null, callSite: "sage_embedding_ingest" },
  });
  const [docVector, ...chunkVectors] = vectors;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "visionquest"."ProgramDocument"
      SET embedding = ${toVectorLiteral(docVector)}::vector(768)
      WHERE id = ${docId}
    `;

    await tx.documentChunk.deleteMany({ where: { documentId: docId } });

    for (let i = 0; i < chunks.length; i++) {
      const row = await tx.documentChunk.create({
        data: { documentId: docId, chunkIndex: i, content: chunks[i] },
        select: { id: true },
      });
      await tx.$executeRaw`
        UPDATE "visionquest"."DocumentChunk"
        SET embedding = ${toVectorLiteral(chunkVectors[i])}::vector(768)
        WHERE id = ${row.id}
      `;
    }
  });

  return { chunkCount: chunks.length };
}
