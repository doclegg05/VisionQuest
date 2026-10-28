import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "@/lib/zod-csp";

/**
 * The document verification token: one implementation of one MAC.
 *
 * A packet's QR code carries a token minted here; `/api/verify/document` checks
 * it here too. Signing and verifying were briefly written twice — once in the
 * PDF generator and once in the route — which is a bad shape for a security
 * primitive: the two copies only agree until someone edits one of them, and the
 * failure is silent (every packet issued after the drift simply stops
 * verifying, and nobody finds out until a caseworker scans a QR).
 *
 * Format: `vqd1.<base64url payload JSON>.<base64url HMAC-SHA256>`
 *
 * The MAC covers the string `"vqd1." + payloadSegment` — the version sits
 * INSIDE the signed material, so a future v2 token cannot be stripped back to a
 * v1 one by an attacker rewriting the prefix.
 *
 * The token proves the holder was given a document this program issued. It is
 * deliberately not a capability to read anything about the person: the payload
 * carries a file id, an issue time, and optionally the document's own digest,
 * and the verifier answers only about the document. A leaked token therefore
 * discloses nothing personal, which is what makes an unauthenticated verifier
 * defensible at all.
 */

/** Bounds the payload so a megabyte of base64 never reaches JSON.parse. */
const TOKEN_PATTERN = /^vqd1\.[A-Za-z0-9_-]{1,512}\.[A-Za-z0-9_-]{43}$/;

const SIGNATURE_BYTES = 32;

/**
 * The signature is the only thing between a forger and a page citing two
 * statutes, so a placeholder ("test", "changeme") is treated as no key at all
 * rather than quietly signing with it. `render.yaml` generates a real one.
 */
export const MIN_SECRET_LENGTH = 32;

export const tokenPayloadSchema = z.object({
  v: z.literal(1),
  fid: z.string().min(1).max(64),
  iat: z.number().int().nonnegative(),
  /**
   * Optional. The digest recorded on the FileUpload row is authoritative; this
   * is only the issuer's own assertion, useful for a packet issued before the
   * digest was persisted. Rejected unless it is a real SHA-256, so a token can
   * never put arbitrary text on the verification page.
   */
  dig: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

export type DocumentTokenPayload = z.infer<typeof tokenPayloadSchema>;

/** Read the signing key, or null when it is absent or a placeholder. */
export function readDocumentVerificationSecret(): string | null {
  const secret = process.env.DOCUMENT_VERIFICATION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return secret;
}

/**
 * Mint a token for a packet.
 *
 * @throws when `DOCUMENT_VERIFICATION_SECRET` is missing or too short. Callers
 * that would rather issue a packet with no QR than fail outright should catch
 * and log — an unverifiable packet is worse than no packet only if nobody is
 * told about it.
 */
export function signDocumentVerificationToken(fileUploadId: string, pdfDigest?: string): string {
  const secret = readDocumentVerificationSecret();
  if (!secret) {
    throw new Error("DOCUMENT_VERIFICATION_SECRET is not configured");
  }

  const payload: Record<string, unknown> = {
    v: 1,
    fid: fileUploadId,
    iat: Math.floor(Date.now() / 1000),
  };
  if (pdfDigest) payload.dig = pdfDigest;

  const segment = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(`vqd1.${segment}`).digest("base64url");
  return `vqd1.${segment}.${signature}`;
}

/**
 * Check a token and return its payload, or null.
 *
 * Null for every failure — malformed, wrong key, edited payload, foreign token.
 * The caller must not distinguish between them to the outside world: telling a
 * prober which part of their forgery was wrong is how a forgery gets refined.
 */
export function verifyDocumentToken(token: string, secret: string): DocumentTokenPayload | null {
  if (!TOKEN_PATTERN.test(token)) return null;

  const [prefix, payloadSegment, signatureSegment] = token.split(".");

  const expected = createHmac("sha256", secret).update(`${prefix}.${payloadSegment}`).digest();
  const provided = Buffer.from(signatureSegment, "base64url");
  if (provided.length !== SIGNATURE_BYTES || expected.length !== SIGNATURE_BYTES) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const parsed = tokenPayloadSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}
