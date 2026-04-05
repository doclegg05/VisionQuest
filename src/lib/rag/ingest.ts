// src/lib/rag/ingest.ts

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { extractFromFile } from "./extract";
import { chunkDocument } from "./chunker";
import { getEmbeddingProvider } from "./embedding-provider";
import type { SourceType, SourceTier } from "@prisma/client";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface IngestOptions {
  sourceType: SourceType;
  sourceTier: SourceTier;
  sourceWeight?: number;
  uploadedBy?: string;
  certificationId?: string;
  platformId?: string;
  formCode?: string;
  aliases?: string[];
  audience?: "student" | "teacher" | "both";
}

export interface IngestResult {
  sourceDocumentId: string;
  chunksCreated: number;
  skipped: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Extension → MIME mapping for directory walking
// ---------------------------------------------------------------------------

const EXT_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXT_TO_MIME));

const SKIP_DIRECTORIES = new Set(["_archive", "node_modules", ".git"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 25);
}

export function computeContentHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Strip instruction-injection patterns from uploaded content.
 * Case-insensitive, removes entire lines that match known prompt-injection phrases.
 */
export function sanitizeUploadedContent(text: string): string {
  const INJECTION_PATTERNS = [
    /ignore previous instructions/i,
    /ignore all previous/i,
    /you are now/i,
    /disregard your/i,
    /^system:/i,
    /act as/i,
    /pretend to be/i,
  ];

  const lines = text.split("\n");
  const cleaned = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return !INJECTION_PATTERNS.some((pattern) => pattern.test(trimmed));
  });

  return cleaned.join("\n");
}

function getMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}

// ---------------------------------------------------------------------------
// Single file ingestion
// ---------------------------------------------------------------------------

export async function ingestFile(
  filePath: string,
  options: IngestOptions,
): Promise<IngestResult> {
  const mimeType = getMimeType(filePath);
  if (!mimeType) {
    return {
      sourceDocumentId: "",
      chunksCreated: 0,
      skipped: true,
      error: `Unsupported file type: ${path.extname(filePath)}`,
    };
  }

  let sourceDocId = "";

  try {
    // 1. Read file and compute hash
    const buffer = await fs.readFile(filePath);
    const contentHash = computeContentHash(buffer);
    const title = path.basename(filePath, path.extname(filePath));

    // 2. Check for existing completed ingestion with same fingerprint
    const existing = await prisma.sourceDocument.findUnique({
      where: {
        sourceType_sourcePath_contentHash: {
          sourceType: options.sourceType,
          sourcePath: filePath,
          contentHash,
        },
      },
    });

    if (existing && existing.ingestionStatus === "completed") {
      logger.info("Skipping already-ingested document", {
        filePath,
        sourceDocumentId: existing.id,
      });
      return {
        sourceDocumentId: existing.id,
        chunksCreated: 0,
        skipped: true,
      };
    }

    // 3. Create or update SourceDocument → processing
    const sourceDoc = await prisma.sourceDocument.upsert({
      where: {
        sourceType_sourcePath_contentHash: {
          sourceType: options.sourceType,
          sourcePath: filePath,
          contentHash,
        },
      },
      create: {
        sourceType: options.sourceType,
        sourceTier: options.sourceTier,
        sourcePath: filePath,
        title,
        mimeType,
        contentHash,
        sourceWeight: options.sourceWeight ?? 1.0,
        uploadedBy: options.uploadedBy ?? null,
        certificationId: options.certificationId ?? null,
        platformId: options.platformId ?? null,
        formCode: options.formCode ?? null,
        aliases: options.aliases ?? [],
        ingestionStatus: "processing",
        metadata: {},
      },
      update: {
        ingestionStatus: "processing",
        ingestionError: null,
      },
    });

    sourceDocId = sourceDoc.id;

    // 4. Extract text
    const extracted = await extractFromFile(filePath, mimeType);

    // 5. Chunk
    const chunks = chunkDocument(extracted.pages, extracted.title);

    if (chunks.length === 0) {
      await prisma.sourceDocument.update({
        where: { id: sourceDocId },
        data: {
          ingestionStatus: "completed",
          lastIngestedAt: new Date(),
        },
      });
      return { sourceDocumentId: sourceDocId, chunksCreated: 0, skipped: false };
    }

    // 6. Sanitize uploaded content if applicable
    const processedChunks =
      options.sourceType === "uploaded"
        ? chunks.map((c) => ({ ...c, content: sanitizeUploadedContent(c.content) }))
        : chunks;

    // 7. Delete old chunks for this source document before inserting new ones
    await prisma.contentChunk.deleteMany({
      where: { sourceDocumentId: sourceDocId },
    });

    // 8. Embed all chunks
    const provider = getEmbeddingProvider();
    const texts = processedChunks.map((c) => c.content);
    const embeddings = await provider.embed(texts);

    // 9. Store chunks with raw SQL for vector + tsvector columns
    for (let i = 0; i < processedChunks.length; i++) {
      const chunk = processedChunks[i];
      const embedding = embeddings[i];
      const chunkId = generateId();
      const vectorStr = `[${embedding.join(",")}]`;

      await prisma.$executeRawUnsafe(
        `INSERT INTO "visionquest"."ContentChunk" (
          id, "sourceDocumentId", "parentId", "chunkIndex",
          "sectionHeading", breadcrumb, content,
          "pageNumber", "charStart", "charEnd",
          "tokenCount", "chunkType", "ocrUsed",
          embedding, search_body,
          "embeddingModel", "embeddingVersion", "chunkingVersion",
          "isActive", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7,
          $8, $9, $10,
          $11, $12, $13,
          $14::vector,
          setweight(to_tsvector('english', coalesce($15, '')), 'A') ||
          setweight(to_tsvector('english', coalesce($6, '')), 'B') ||
          setweight(to_tsvector('english', coalesce($5, '')), 'B') ||
          setweight(to_tsvector('english', coalesce($7, '')), 'C'),
          $16, $17, $18,
          true, NOW(), NOW()
        )`,
        chunkId,
        sourceDocId,
        null, // parentId
        i, // chunkIndex
        chunk.sectionHeading, // $5
        chunk.breadcrumb, // $6
        chunk.content, // $7
        chunk.pageNumber, // $8
        chunk.charStart, // $9
        chunk.charEnd, // $10
        chunk.tokenCount, // $11
        chunk.chunkType, // $12
        chunk.ocrUsed, // $13
        vectorStr, // $14
        title, // $15 — document title for search_body weight A
        provider.name, // $16
        provider.version, // $17
        "v1", // $18 — chunkingVersion
      );
    }

    // 10. Mark completed
    await prisma.sourceDocument.update({
      where: { id: sourceDocId },
      data: {
        ingestionStatus: "completed",
        lastIngestedAt: new Date(),
        ingestionError: null,
      },
    });

    logger.info("Ingestion completed", {
      filePath,
      sourceDocumentId: sourceDocId,
      chunksCreated: processedChunks.length,
    });

    return {
      sourceDocumentId: sourceDocId,
      chunksCreated: processedChunks.length,
      skipped: false,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);

    logger.error("Ingestion failed", { filePath, sourceDocumentId: sourceDocId, error: message });

    // Update SourceDocument to failed if we have an ID
    if (sourceDocId) {
      try {
        await prisma.sourceDocument.update({
          where: { id: sourceDocId },
          data: {
            ingestionStatus: "failed",
            ingestionError: message,
          },
        });
      } catch (updateError: unknown) {
        logger.error("Failed to update ingestion status", {
          sourceDocumentId: sourceDocId,
          error:
            updateError instanceof Error
              ? updateError.message
              : String(updateError),
        });
      }
    }

    return {
      sourceDocumentId: sourceDocId,
      chunksCreated: 0,
      skipped: false,
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Directory ingestion
// ---------------------------------------------------------------------------

async function walkDirectory(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const nested = await walkDirectory(fullPath);
      files.push(...nested);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export async function ingestDirectory(
  dirPath: string,
  options: IngestOptions,
): Promise<IngestResult[]> {
  const files = await walkDirectory(dirPath);

  logger.info("Starting directory ingestion", {
    dirPath,
    fileCount: files.length,
  });

  const results: IngestResult[] = [];

  for (const filePath of files) {
    const result = await ingestFile(filePath, options);
    results.push(result);
  }

  const completed = results.filter((r) => !r.skipped && !r.error).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => r.error).length;

  logger.info("Directory ingestion complete", {
    dirPath,
    total: results.length,
    completed,
    skipped,
    failed,
  });

  return results;
}
