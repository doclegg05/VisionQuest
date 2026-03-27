import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import { Readable } from "stream";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const IS_DEV = process.env.NODE_ENV !== "production";
const LOCAL_UPLOAD_DIR = path.join(process.cwd(), "uploads");

// Supabase Storage S3-compatible config
const STORAGE_ENDPOINT = process.env.STORAGE_ENDPOINT || "";
const STORAGE_REGION = process.env.STORAGE_REGION || "us-east-1";
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || "";
const STORAGE_ACCESS_KEY = process.env.STORAGE_ACCESS_KEY || "";
const STORAGE_SECRET_KEY = process.env.STORAGE_SECRET_KEY || "";
const HAS_STORAGE_CONFIG = Boolean(STORAGE_ENDPOINT && STORAGE_BUCKET && STORAGE_ACCESS_KEY && STORAGE_SECRET_KEY);

// Legacy R2 support — if R2 vars are set but new vars aren't, use R2
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
    const filePath = path.join(LOCAL_UPLOAD_DIR, storageKey);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(LOCAL_UPLOAD_DIR) + path.sep)) {
      throw new Error("Invalid storage path");
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
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
    const filePath = path.join(LOCAL_UPLOAD_DIR, storageKey);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(LOCAL_UPLOAD_DIR) + path.sep)) {
      throw new Error("Invalid storage path");
    }
    try {
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(storageKey).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
      };
      return { buffer, mimeType: mimeMap[ext] || "application/octet-stream" };
    } catch {
      return null;
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
      return null;
    }

    throw error;
  }
}

/**
 * Delete a file from storage.
 */
export async function deleteFile(storageKey: string): Promise<void> {
  if (shouldUseLocalDisk()) {
    const filePath = path.join(LOCAL_UPLOAD_DIR, storageKey);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(LOCAL_UPLOAD_DIR) + path.sep)) {
      throw new Error("Invalid storage path");
    }
    try {
      await fs.unlink(filePath);
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
