import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import { Readable } from "stream";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const IS_DEV = process.env.NODE_ENV !== "production";
// turbopackIgnore comments below tell Turbopack not to trace these paths
// statically. Without them the recursive fs.readdir() in findInContentDir()
// causes the entire project tree to be pulled into the standalone NFT,
// inflating the server bundle. These dirs are runtime artifacts, not deps.
const LOCAL_UPLOAD_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "uploads");
const BUNDLED_UPLOAD_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "docs-upload");

// Supabase Storage S3-compatible config
const STORAGE_ENDPOINT = process.env.STORAGE_ENDPOINT || "";
const STORAGE_REGION = process.env.STORAGE_REGION || "us-east-1";
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || "";
const STORAGE_ACCESS_KEY = process.env.STORAGE_ACCESS_KEY || "";
const STORAGE_SECRET_KEY = process.env.STORAGE_SECRET_KEY || "";
const HAS_STORAGE_CONFIG = Boolean(STORAGE_ENDPOINT && STORAGE_BUCKET && STORAGE_ACCESS_KEY && STORAGE_SECRET_KEY);

// Cloudflare R2 — active secondary backend. Used in Render prod, local dev,
// and other envs where R2_* vars are configured. `STORAGE_*` (Supabase Storage)
// is preferred when set; R2 is selected when only the R2_* vars are present.
// Do not delete: this branch is live, not legacy.
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_BUCKET = process.env.R2_BUCKET_NAME || "";
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY || "";
const R2_SECRET_KEY = process.env.R2_SECRET_KEY || "";
const HAS_R2_CONFIG = Boolean(R2_ACCOUNT_ID && R2_BUCKET && R2_ACCESS_KEY && R2_SECRET_KEY);

function buildS3Client(): S3Client | null {
  if (IS_DEV && !HAS_STORAGE_CONFIG && !HAS_R2_CONFIG) return null;

  if (HAS_STORAGE_CONFIG) {
    return new S3Client({
      region: STORAGE_REGION,
      endpoint: STORAGE_ENDPOINT,
      credentials: {
        accessKeyId: STORAGE_ACCESS_KEY,
        secretAccessKey: STORAGE_SECRET_KEY,
      },
      forcePathStyle: true,
    });
  }

  if (HAS_R2_CONFIG) {
    return new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY,
      },
    });
  }

  return null;
}

const s3Client = buildS3Client();
const BUCKET = STORAGE_BUCKET || R2_BUCKET;

function getS3Client(): S3Client {
  if (!s3Client || !BUCKET) {
    throw new Error(
      "File storage is not configured. Set STORAGE_ENDPOINT, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, and STORAGE_BUCKET."
    );
  }
  return s3Client;
}

function shouldUseLocalDisk(): boolean {
  return IS_DEV && !s3Client;
}

function resolveStoragePath(baseDir: string, storageKey: string): string {
  const filePath = path.join(baseDir, storageKey);
  const resolved = path.resolve(filePath);
  const relative = path.relative(path.resolve(baseDir), resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative) || !relative) {
    throw new Error("Invalid storage path");
  }

  return resolved;
}

function inferMimeType(storageKey: string): string {
  const ext = path.extname(storageKey).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
  };

  return mimeMap[ext] || "application/octet-stream";
}

// Local docs-upload/ top-level folder → bucket key prefix. This is the single
// TS source of truth for the convention minted by scripts/upload-to-supabase.mjs
// and scripts/seed-documents.mjs, and enforced in the live DB by the manually
// applied CHECK constraint program_document_storage_key_shape on ProgramDocument.
// Folders absent here (e.g. sage-context/) have no bucket convention and must
// not be indexed.
const LOCAL_FOLDER_TO_BUCKET_PREFIX: Record<string, string> = {
  forms: "forms",
  orientation: "orientation",
  lms: "lms",
  students: "students/resources",
  teachers: "teachers/guides",
  presentation: "presentations",
};

/**
 * Map a docs-upload/-relative path (forward slashes) to its bucket storageKey.
 * Returns null for paths under unmapped top-level folders and for root-level
 * files — the uploader skips those, so no bucket object can exist for them.
 */
export function mapLocalPathToStorageKey(relativePath: string): string | null {
  const [topFolder, ...restParts] = relativePath.split("/");
  const prefix = LOCAL_FOLDER_TO_BUCKET_PREFIX[topFolder];
  if (!prefix || restParts.length === 0) return null;
  const rest = restParts.join("/");

  // Handbook appendix Section 16 = certification module descriptors → lms/
  // (same special case as the uploader/seeder scripts)
  if (topFolder === "teachers" && rest.includes("Handbook Appendix/Section 16/")) {
    return `lms/certifications/program-info/${restParts[restParts.length - 1]}`;
  }

  return `${prefix}/${rest}`;
}

// Bundled reads must reverse the renames or keys under the renamed prefixes
// never resolve locally. Derived from the forward map so they cannot drift.
const BUNDLED_KEY_PREFIX_TO_LOCAL: Record<string, string> = Object.fromEntries(
  Object.entries(LOCAL_FOLDER_TO_BUCKET_PREFIX)
    .filter(([local, bucket]) => local !== bucket)
    .map(([local, bucket]) => [`${bucket}/`, `${local}/`]),
);

/**
 * Candidate docs-upload/-relative paths for a bucket storageKey, in resolution
 * order: the key itself, then the reverse of any uploader folder rename.
 * Shared by downloadBundledFile and the standalone asset-staging build step
 * (scripts/prepare-standalone-assets.mjs) so the two can't drift.
 */
export function bundledCandidatePaths(storageKey: string): string[] {
  const candidates = [storageKey];
  for (const [keyPrefix, localPrefix] of Object.entries(BUNDLED_KEY_PREFIX_TO_LOCAL)) {
    if (storageKey.startsWith(keyPrefix)) {
      candidates.push(localPrefix + storageKey.slice(keyPrefix.length));
    }
  }
  return candidates;
}

export async function downloadBundledFile(
  storageKey: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  for (const candidate of bundledCandidatePaths(storageKey)) {
    try {
      const resolved = resolveStoragePath(BUNDLED_UPLOAD_DIR, candidate);
      const buffer = await fs.readFile(resolved);
      return {
        buffer,
        mimeType: inferMimeType(storageKey),
      };
    } catch {
      // try the next candidate path
    }
  }

  // Fallback: search content directory by filename
  return findInContentDir(storageKey);
}

const CONTENT_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "content");

function normalizeForMatch(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const base = path.basename(filename, ext);
  return base.toLowerCase().replace(/[^a-z0-9]/g, "") + ext;
}

async function findInContentDir(
  storageKey: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const targetName = path.basename(storageKey);
  if (!targetName || targetName.includes("..")) return null;

  const allFiles: string[] = [];

  async function search(dir: string): Promise<string | null> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "_archive") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await search(full);
        if (found) return found;
      } else if (entry.name === targetName) {
        return full; // Exact match — return immediately
      } else {
        allFiles.push(full); // Collect for fuzzy pass
      }
    }
    return null;
  }

  // Pass 1: exact match
  const exactMatch = await search(CONTENT_DIR);
  if (exactMatch) {
    try {
      const buffer = await fs.readFile(exactMatch);
      return { buffer, mimeType: inferMimeType(exactMatch) };
    } catch {
      return null;
    }
  }

  // Pass 2: normalized fuzzy match
  const normalizedTarget = normalizeForMatch(targetName);
  for (const filePath of allFiles) {
    const normalizedCandidate = normalizeForMatch(path.basename(filePath));
    if (
      normalizedTarget === normalizedCandidate ||
      normalizedTarget.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedTarget)
    ) {
      try {
        const buffer = await fs.readFile(filePath);
        return { buffer, mimeType: inferMimeType(filePath) };
      } catch {
        continue;
      }
    }
  }

  return null;
}

function isTransformableBody(body: unknown): body is { transformToByteArray: () => Promise<Uint8Array> } {
  return Boolean(body && typeof body === "object" && "transformToByteArray" in body);
}

async function readBodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  if (isTransformableBody(body)) {
    return Buffer.from(await body.transformToByteArray());
  }
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported object storage response body.");
}

/**
 * Generate a unique storage key for a file.
 */
export function generateStorageKey(studentId: string, filename: string): string {
  const ext = path.extname(filename);
  const uuid = randomUUID();
  return `${studentId}/${uuid}${ext}`;
}

/**
 * Upload a file buffer to storage.
 * Dev (no config): saves to local ./uploads/ directory
 * Prod: uploads via S3-compatible API (Supabase Storage or Cloudflare R2)
 */
export async function uploadFile(
  storageKey: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  if (shouldUseLocalDisk()) {
    const resolved = resolveStoragePath(LOCAL_UPLOAD_DIR, storageKey);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, buffer);
    return;
  }

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: mimeType,
    })
  );
}

/**
 * Download a file from storage.
 */
export async function downloadFile(storageKey: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (shouldUseLocalDisk()) {
    try {
      const resolved = resolveStoragePath(LOCAL_UPLOAD_DIR, storageKey);
      const buffer = await fs.readFile(resolved);
      return { buffer, mimeType: inferMimeType(storageKey) };
    } catch {
      return downloadBundledFile(storageKey);
    }
  }

  try {
    const result = await getS3Client().send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
      })
    );

    if (!result.Body) return null;

    return {
      buffer: await readBodyToBuffer(result.Body),
      mimeType: result.ContentType || "application/octet-stream",
    };
  } catch (error) {
    const statusCode = typeof error === "object" && error && "$metadata" in error
      ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      : undefined;

    if (statusCode === 404) {
      return downloadBundledFile(storageKey);
    }

    throw error;
  }
}

interface PresignedDownloadOptions {
  /** Seconds before the URL expires. Defaults to 3600 (1 hour). */
  expiresIn?: number;
  /** Override the response Content-Type (e.g. force "application/pdf"). */
  contentType?: string;
  /** Full Content-Disposition header to set on the response (e.g. `inline; filename="..."`). */
  contentDisposition?: string;
}

/**
 * Generate a presigned GET URL for a storage object.
 *
 * Returns `null` when:
 *   - The USE_PRESIGNED_URLS feature flag is not "true", OR
 *   - Object storage is not configured (local dev without Supabase/R2 creds)
 *
 * Callers should check for null and fall back to `downloadFile()` (which
 * handles the local-disk + bundled-content paths).
 *
 * Phase 2 of docs/plans/supabase-optimization.md.
 */
export async function getPresignedDownloadUrl(
  storageKey: string,
  options: PresignedDownloadOptions = {},
): Promise<string | null> {
  if (process.env.USE_PRESIGNED_URLS !== "true") return null;
  if (!s3Client || !BUCKET) return null;

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ResponseContentType: options.contentType,
    ResponseContentDisposition: options.contentDisposition,
  });

  return getSignedUrl(s3Client, command, {
    expiresIn: options.expiresIn ?? 3600,
  });
}

/**
 * Delete a file from storage.
 */
export async function deleteFile(storageKey: string): Promise<void> {
  if (shouldUseLocalDisk()) {
    try {
      const resolved = resolveStoragePath(LOCAL_UPLOAD_DIR, storageKey);
      await fs.unlink(resolved);
    } catch {
      // file may not exist
    }
    return;
  }

  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
    })
  );
}

/** True when an S3-compatible backend (Supabase Storage or R2) is configured. */
export function isObjectStorageConfigured(): boolean {
  return Boolean(s3Client && BUCKET);
}

/**
 * Check whether an object exists in the configured bucket via HeadObject.
 * Throws if object storage is not configured — callers that need a
 * guarantee (e.g. Sage ingest) must fail fast rather than guess.
 */
export async function storageObjectExists(storageKey: string): Promise<boolean> {
  try {
    await getS3Client().send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: storageKey })
    );
    return true;
  } catch (error) {
    const statusCode = typeof error === "object" && error && "$metadata" in error
      ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      : undefined;

    if (statusCode === 404) return false;
    throw error;
  }
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
];

export function validateFile(file: { size: number; type: string }): string | null {
  if (file.size > MAX_FILE_SIZE) return "File too large (max 10MB)";
  if (!ALLOWED_TYPES.includes(file.type)) return "File type not allowed (PDF, JPG, PNG, GIF only)";
  return null;
}
