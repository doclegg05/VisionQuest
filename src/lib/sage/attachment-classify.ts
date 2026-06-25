/**
 * Persisted attachment-classification cache.
 *
 * Wraps the pure classifier (classify-attachment.ts) with read-through caching
 * on FileUpload so vision isn't re-run every turn:
 *   - Upload time writes a FREE local baseline (cloudAllowed=false).
 *   - The first time Sage classifies an attachment WITH active consent, the
 *     local baseline is upgraded to a cloud pass and persisted.
 *   - Once a cloud result is cached, it's reused as-is.
 *
 * The cache/recompute decision is a pure function (shouldRecomputeClassification)
 * so it can be unit-tested without a database.
 */

import { prisma } from "@/lib/db";
import { downloadFile } from "@/lib/storage";
import { logger } from "@/lib/logger";
import {
  classifyAttachment,
  normalizeClassification,
  type AttachmentClassification,
  type ClassifyAttachmentResult,
} from "./classify-attachment";

export type ClassificationMethod = ClassifyAttachmentResult["method"];

export interface CachedClassificationFile {
  id: string;
  filename: string;
  mimeType: string;
  storageKey: string;
  classification: unknown;
  classificationMethod: string | null;
}

export interface EnsureClassificationResult {
  classification: AttachmentClassification;
  method: ClassificationMethod;
  /** True when served from the persisted cache (no model/extraction call). */
  fromCache: boolean;
}

/**
 * Decide whether to recompute a classification or reuse the cached one.
 *
 * - No usable cache → recompute.
 * - Cached cloud result → reuse (best we can get).
 * - Cached local/none result but cloud now allowed → recompute (upgrade).
 * - Cached local/none result and cloud not allowed → reuse (can't do better).
 */
export function shouldRecomputeClassification(
  hasCache: boolean,
  cachedMethod: string | null,
  cloudAllowed: boolean,
): boolean {
  if (!hasCache) return true;
  if (cachedMethod === "cloud") return false;
  if (!cloudAllowed) return false;
  return true;
}

/**
 * Return a structured classification for an uploaded file, reusing the
 * persisted cache when appropriate and otherwise computing + persisting it.
 *
 * `buffer` lets the upload path pass bytes it already has; otherwise the file
 * is fetched from storage.
 */
export async function ensureClassification(params: {
  file: CachedClassificationFile;
  studentId: string;
  cloudAllowed: boolean;
  buffer?: Buffer;
}): Promise<EnsureClassificationResult | null> {
  const { file, studentId, cloudAllowed } = params;

  const cached = normalizeClassification(file.classification);
  if (!shouldRecomputeClassification(Boolean(cached), file.classificationMethod, cloudAllowed)) {
    return {
      classification: cached as AttachmentClassification,
      method: (file.classificationMethod as ClassificationMethod) ?? "none",
      fromCache: true,
    };
  }

  let buffer = params.buffer;
  if (!buffer) {
    const download = await downloadFile(file.storageKey);
    if (!download) return null;
    buffer = download.buffer;
  }

  const { classification, method } = await classifyAttachment({
    buffer,
    filename: file.filename,
    mimeType: file.mimeType,
    studentId,
    cloudAllowed,
  });

  // Best-effort persist — a cache write failure must not fail the caller.
  try {
    await prisma.fileUpload.update({
      where: { id: file.id },
      data: {
        classification: classification as unknown as object,
        classificationMethod: method,
        classifiedAt: new Date(),
      },
    });
  } catch (error) {
    logger.warn("Failed to persist attachment classification", {
      fileUploadId: file.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { classification, method, fromCache: false };
}
