import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ingestFile } from "@/lib/rag/ingest";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/markdown",
  "text/plain",
]);

/**
 * POST /api/rag/ingest
 *
 * Teacher-only endpoint for uploading documents into the RAG pipeline.
 * Accepts multipart form data with `file` and `title` fields.
 * Returns immediately with a pending status; ingestion runs in the background.
 */
export const POST = withTeacherAuth(async (session, req: Request) => {
  const formData = await req.formData();

  // --- Validate file ---
  const fileEntry = formData.get("file");
  if (!fileEntry || !(fileEntry instanceof File)) {
    return NextResponse.json(
      { error: "A file is required." },
      { status: 400 },
    );
  }

  // --- Validate title ---
  const titleRaw = formData.get("title");
  const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
  if (!title) {
    return NextResponse.json(
      { error: "A non-empty title is required." },
      { status: 400 },
    );
  }

  // --- Validate file size ---
  if (fileEntry.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File exceeds maximum size of 10 MB." },
      { status: 400 },
    );
  }

  // --- Validate MIME type ---
  if (!ALLOWED_MIME_TYPES.has(fileEntry.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${fileEntry.type}. Allowed: PDF, DOCX, XLSX, Markdown, plain text.` },
      { status: 400 },
    );
  }

  // --- Compute content hash ---
  const buffer = Buffer.from(await fileEntry.arrayBuffer());
  const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");

  // --- Check for duplicate ---
  const existing = await prisma.sourceDocument.findUnique({
    where: {
      sourceType_sourcePath_contentHash: {
        sourceType: "uploaded",
        sourcePath: fileEntry.name,
        contentHash,
      },
    },
  });

  if (existing && existing.ingestionStatus === "completed") {
    return NextResponse.json({
      success: true,
      data: {
        sourceDocumentId: existing.id,
        ingestionStatus: "completed",
        estimatedDurationMs: 0,
      },
    });
  }

  // --- Create SourceDocument ---
  const sourceDoc = await prisma.sourceDocument.create({
    data: {
      sourceType: "uploaded",
      sourceTier: "user_uploaded",
      sourcePath: fileEntry.name,
      title,
      mimeType: fileEntry.type,
      contentHash,
      sourceWeight: 1.0,
      uploadedBy: session.id,
      ingestionStatus: "pending",
      metadata: {},
    },
  });

  // --- Write file to temp directory ---
  const tempDir = os.tmpdir();
  const tempPath = path.join(tempDir, `rag-${sourceDoc.id}-${fileEntry.name}`);
  await fs.writeFile(tempPath, buffer);

  // --- Fire-and-forget ingestion ---
  void ingestFile(tempPath, {
    sourceType: "uploaded",
    sourceTier: "user_uploaded",
    sourceWeight: 1.0,
    uploadedBy: session.id,
  }).catch((err: unknown) => {
    logger.error("Background ingestion failed", {
      sourceDocumentId: sourceDoc.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return NextResponse.json({
    success: true,
    data: {
      sourceDocumentId: sourceDoc.id,
      ingestionStatus: "pending",
      estimatedDurationMs: 15_000,
    },
  });
});
