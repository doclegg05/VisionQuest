import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prismaAdmin } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

/**
 * Public verification of a document this program issued.
 *
 * --- Why this endpoint discloses nothing about a person ---
 *
 * The population is TANF and SNAP adult learners, and for them the sentence
 * "<name> is enrolled in SPOKES in <county>" IS the sensitive disclosure — it
 * reveals benefits status to anyone who can read it. An unauthenticated
 * endpoint that answers with a name, a login username and a county is
 * therefore a FERPA disclosure surface no matter how good its lookup is, and
 * the previous version was additionally reachable by substring, which made it
 * a bulk one.
 *
 * The endpoint is not authenticated, because the caller we want to serve is a
 * caseworker or employer holding a printed packet, who has no account here.
 * Instead it proves the caller HOLDS the document: the QR encodes a token this
 * server signed, and the token is the only accepted input. Whoever scans the
 * packet is already looking at the participant's name on paper, so the
 * verifier does not need to repeat it — it answers the one question the paper
 * cannot answer for itself: "did this program issue this exact file, and does
 * it still hold the record?" Staff who need identity use the authenticated
 * teacher surfaces, which audit the read.
 *
 * A leaked token therefore discloses nothing personal, which is the property
 * that makes an unauthenticated verifier acceptable at all.
 *
 * --- Token contract (v1) ---
 *
 *   vqd1.<base64url(payload JSON)>.<base64url(HMAC-SHA256)>
 *
 * payload: { v: 1, fid: <FileUpload id>, dig: <lowercase hex SHA-256 of the
 * finished PDF bytes>, iat: <unix seconds> }
 *
 * The MAC is taken over the string "vqd1.<payload segment>" — the encoded
 * segment, not the re-serialized object, so no canonicalization question
 * arises — and the version prefix is inside the MAC so a later v2 cannot be
 * downgraded to v1. Key: DOCUMENT_VERIFICATION_SECRET. Absent, the verifier
 * refuses everything and says so at error level; it never falls back to a
 * shared secret, and it never falls back to "looks about right".
 *
 * The digest travels inside the signed token rather than being read back from
 * a column, because no column holds it yet. When one exists, compare
 * payload.dig against the stored value here and refuse on mismatch — that
 * turns the digest from "what the issuer asserted" into "what the issuer
 * recorded", and is the last hardening step this design is waiting on.
 *
 * There is no expiry. A signed paper packet does not stop having been issued,
 * so liveness comes from the record lookup below: delete the FileUpload (a
 * student is offboarded, a packet is voided) and verification starts
 * answering false.
 *
 * --- Why prismaAdmin ---
 *
 * There is no session and therefore no RLS context, so the app client would
 * fail closed and every verification would answer "record_not_found". The
 * admin client is bounded by everything around it: it is reached only after a
 * valid signature, the lookup is by primary key, and the select carries no
 * student column, so it can answer exactly one question about exactly one
 * record the caller already proved they hold.
 */

/** vqd1.<payload>.<43-char base64url HMAC-SHA256>. Bounds the payload so a
 *  megabyte of base64 never reaches JSON.parse. */
const TOKEN_PATTERN = /^vqd1\.[A-Za-z0-9_-]{1,512}\.[A-Za-z0-9_-]{43}$/;

const SIGNATURE_BYTES = 32;

/** The signature is the only thing between a forger and a page carrying two
 *  statutes, so a placeholder value ("test", "changeme") is treated as no key
 *  at all rather than quietly signing with it. render.yaml generates one. */
const MIN_SECRET_LENGTH = 32;

/** Public callers, so the window is per source address and generous enough for
 *  a classroom or agency office sharing one egress IP. */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/** Document category -> the label shown to whoever scanned the QR. Categories
 *  outside this map fall back to a generic phrase rather than echoing the
 *  stored value, which is program vocabulary, not public copy. */
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  orientation: "SPOKES intake and policy agreement packet",
};

const GENERIC_DOCUMENT_TYPE = "SPOKES program document";

const ISSUING_AGENCY = "West Virginia SPOKES Program / West Virginia Adult Education";

const LEGAL_STANDARD =
  "West Virginia Uniform Electronic Transactions Act (W. Va. Code § 39A-1-1) & Federal E-SIGN Act (15 U.S.C. § 7001)";

/** External data is untyped until parsed, signature or no signature. */
const tokenPayloadSchema = z.object({
  v: z.literal(1),
  fid: z.string().min(1).max(64),
  dig: z.string().regex(/^[0-9a-f]{64}$/),
  iat: z.number().int().nonnegative(),
});

type TokenPayload = z.infer<typeof tokenPayloadSchema>;

function verifyDocumentToken(token: string, secret: string): TokenPayload | null {
  if (!TOKEN_PATTERN.test(token)) return null;

  const [prefix, payloadSegment, signatureSegment] = token.split(".");

  const expected = createHmac("sha256", secret)
    .update(`${prefix}.${payloadSegment}`)
    .digest();
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

function refuse(reason: string, status: number, message: string): NextResponse {
  return NextResponse.json({ verified: false, reason, error: message }, { status });
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await rateLimit(`verify-document:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!limit.success) {
    return refuse(
      "rate_limited",
      429,
      "Too many verification attempts from this network. Please try again in a few minutes.",
    );
  }

  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return refuse(
      "missing_token",
      400,
      "This link is not a verification link. Scan the QR code printed on the document itself.",
    );
  }

  const secret = process.env.DOCUMENT_VERIFICATION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    // Fail closed and loudly: a verifier with no usable key must never be the
    // reason a forged document passes.
    logger.error("Document verification secret is missing or too short", {
      alert: "document_verify_secret_missing",
      configured: Boolean(secret),
    });
    return refuse(
      "verifier_unavailable",
      503,
      "Document verification is temporarily unavailable. Please contact the SPOKES program office.",
    );
  }

  const payload = verifyDocumentToken(token, secret);
  if (!payload) {
    return refuse(
      "invalid_token",
      404,
      "This verification code was not issued by the SPOKES program, or it has been altered.",
    );
  }

  let record: { id: string; category: string; uploadedAt: Date } | null;
  try {
    record = await prismaAdmin.fileUpload.findUnique({
      where: { id: payload.fid },
      // No student column: the attestation must not be able to grow a name by
      // someone later spreading this object into a response.
      select: { id: true, category: true, uploadedAt: true },
    });
  } catch (error) {
    logger.error("Document verification lookup failed", {
      alert: "document_verify_lookup_failed",
      error: String(error),
    });
    return refuse(
      "verification_unavailable",
      500,
      "Document verification is temporarily unavailable. Please try again shortly.",
    );
  }

  if (!record) {
    // A validly signed token with no record behind it is worth seeing: it is
    // either an offboarded student or a signing key used somewhere unexpected.
    // studentLogKey is a one-way correlation key — the raw record id is an
    // identifier and does not belong in a log payload.
    logger.warn("Signed verification token has no matching record", {
      alert: "document_verify_record_missing",
      documentKey: studentLogKey(payload.fid),
    });
    return refuse(
      "record_not_found",
      404,
      "The SPOKES program no longer holds a record for this document.",
    );
  }

  return NextResponse.json({
    verified: true,
    documentType: DOCUMENT_TYPE_LABELS[record.category] ?? GENERIC_DOCUMENT_TYPE,
    issuedAt: record.uploadedAt.toISOString(),
    documentDigest: payload.dig,
    issuingAgency: ISSUING_AGENCY,
    legalStandard: LEGAL_STANDARD,
  });
}
