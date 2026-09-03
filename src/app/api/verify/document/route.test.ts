import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { NextRequest } from "next/server";

/**
 * The public document verifier is the one endpoint in the app that answers an
 * unauthenticated caller about a real participant, so these cases pin the two
 * disclosure invariants first (no enumeration, no PII) and only then the happy
 * path. Every case here was observed failing against the pre-hardening route.
 */

const TEST_SECRET = "test-document-verification-secret";

// Values a leaky verifier would echo. Asserted absent from every response body.
const PII = {
  displayName: "Jane Q. Participant",
  loginUsername: "JPARTICIPANT01",
  county: "Kanawha",
  referralEmail: "referral@example.gov",
  reviewerName: "Ms. Reviewer",
};

const FILE_UPLOAD_ID = "cmfileupload000000000001";
const PDF_DIGEST = "a".repeat(64);

function signToken(payload: Record<string, unknown>, secret = TEST_SECRET): string {
  const segment = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(`vqd1.${segment}`).digest("base64url");
  return `vqd1.${segment}.${signature}`;
}

function validPayload() {
  return { v: 1, fid: FILE_UPLOAD_ID, dig: PDF_DIGEST, iat: 1756900000 };
}

/** A FileUpload row joined to its student, as the leaky route selected it. */
const fileUploadWithStudent = {
  id: FILE_UPLOAD_ID,
  filename: `Official_Intake_Packet_${PII.loginUsername}.pdf`,
  category: "orientation",
  uploadedAt: new Date("2026-09-01T15:04:05.000Z"),
  student: {
    id: "student-1",
    studentId: PII.loginUsername,
    displayName: PII.displayName,
    spokesRecord: { county: PII.county, referralEmail: PII.referralEmail },
  },
};

/** Every Prisma call the route makes, so a substring filter cannot hide. */
let recordedQueries: unknown[] = [];

function recorder(result: () => unknown) {
  return mock.fn(async (args: unknown) => {
    recordedQueries.push(args);
    return result();
  });
}

let formSubmissionFindFirst = recorder(() => null);
let fileUploadFindFirst = recorder(() => fileUploadWithStudent);
let fileUploadFindUnique = recorder(() => fileUploadWithStudent);
let studentFindUnique = recorder(() => ({ displayName: PII.reviewerName }));

function client() {
  return {
    formSubmission: { findFirst: (a: unknown) => formSubmissionFindFirst(a) },
    fileUpload: {
      findFirst: (a: unknown) => fileUploadFindFirst(a),
      findUnique: (a: unknown) => fileUploadFindUnique(a),
    },
    student: { findUnique: (a: unknown) => studentFindUnique(a) },
  };
}

mock.module("@/lib/db", {
  namedExports: { prisma: client(), prismaAdmin: client() },
});

let rateLimitAllows = true;
const rateLimitMock = mock.fn(async () => ({
  success: rateLimitAllows,
  remaining: 0,
  resetTime: Date.now() + 60_000,
  degraded: false,
}));

mock.module("@/lib/rate-limit", {
  namedExports: { rateLimit: rateLimitMock },
});

const loggerCalls: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];
mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: (message: string, context?: Record<string, unknown>) =>
        loggerCalls.push({ level: "debug", message, context }),
      info: (message: string, context?: Record<string, unknown>) =>
        loggerCalls.push({ level: "info", message, context }),
      warn: (message: string, context?: Record<string, unknown>) =>
        loggerCalls.push({ level: "warn", message, context }),
      error: (message: string, context?: Record<string, unknown>) =>
        loggerCalls.push({ level: "error", message, context }),
    },
  },
});

let route: typeof import("./route");

function get(query: string): Promise<Response> {
  const req = new Request(`http://localhost:3000/api/verify/document?${query}`, {
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
  return route.GET(req as unknown as NextRequest);
}

async function body(res: Response): Promise<{ raw: string; json: Record<string, unknown> }> {
  const raw = await res.text();
  return { raw, json: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} };
}

function assertNoPii(raw: string): void {
  for (const [field, value] of Object.entries(PII)) {
    assert.ok(
      !raw.includes(value),
      `verification response leaked ${field} to an unauthenticated caller: ${raw}`,
    );
  }
}

before(async () => {
  process.env.DOCUMENT_VERIFICATION_SECRET = TEST_SECRET;
  route = await import("./route");
});

beforeEach(() => {
  recordedQueries = [];
  loggerCalls.length = 0;
  rateLimitAllows = true;
  rateLimitMock.mock.resetCalls();
  formSubmissionFindFirst = recorder(() => null);
  fileUploadFindFirst = recorder(() => fileUploadWithStudent);
  fileUploadFindUnique = recorder(() => fileUploadWithStudent);
  studentFindUnique = recorder(() => ({ displayName: PII.reviewerName }));
  process.env.DOCUMENT_VERIFICATION_SECRET = TEST_SECRET;
});

describe("document verifier — enumeration oracle", () => {
  it("does not resolve a storage-key prefix to a participant", async () => {
    // "orientation/" is the first segment of every packet storage key, so a
    // substring match turns this into a character-by-character walk of the roster.
    const res = await get("id=orientation%2F");
    const { raw, json } = await body(res);

    assert.notEqual(json.verified, true, "a storage-key prefix must not verify anything");
    assertNoPii(raw);
  });

  it("does not resolve a one-character id prefix to a participant", async () => {
    const res = await get("id=c");
    const { raw, json } = await body(res);

    assert.notEqual(json.verified, true);
    assertNoPii(raw);
  });

  it("never issues a substring (contains) filter", async () => {
    await get("id=orientation%2F");
    const serialized = JSON.stringify(recordedQueries);
    assert.ok(
      !serialized.includes("contains"),
      `verification lookups must be exact-match; saw: ${serialized}`,
    );
  });
});

describe("document verifier — certify-anything branch", () => {
  it("refuses an arbitrary SHA256:-prefixed string", async () => {
    formSubmissionFindFirst = recorder(() => null);
    fileUploadFindFirst = recorder(() => null);
    fileUploadFindUnique = recorder(() => null);

    const res = await get("hash=SHA256%3AFORGEDBYANYONEWITHAPRINTER");
    const { raw, json } = await body(res);

    assert.equal(json.verified, false, "an unsigned hash string must not verify");
    assert.ok(!raw.includes("39A-1-1"), "a refusal must not carry a legal attestation");
    assertNoPii(raw);
  });

  it("refuses a bare hash with no token", async () => {
    const res = await get("hash=SHA256%3AANYTHING&id=");
    const { json } = await body(res);
    assert.equal(json.verified, false);
  });
});

describe("document verifier — signed tokens", () => {
  it("verifies a token this server signed and returns a minimal attestation", async () => {
    const res = await get(`token=${encodeURIComponent(signToken(validPayload()))}`);
    const { raw, json } = await body(res);

    assert.equal(res.status, 200);
    assert.equal(json.verified, true);
    assert.equal(json.documentDigest, PDF_DIGEST, "the holder compares this against their copy");
    assert.equal(json.issuedAt, "2026-09-01T15:04:05.000Z");
    assertNoPii(raw);

    for (const leaky of ["studentName", "studentId", "county", "reviewedBy", "filename"]) {
      assert.ok(!(leaky in json), `attestation must not carry ${leaky}`);
    }
  });

  it("looks the record up by exact id", async () => {
    await get(`token=${encodeURIComponent(signToken(validPayload()))}`);
    assert.deepEqual(
      (recordedQueries[0] as { where?: unknown }).where,
      { id: FILE_UPLOAD_ID },
    );
  });

  it("refuses a token whose payload was edited after signing", async () => {
    const token = signToken(validPayload());
    const [prefix, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...validPayload(), fid: "someone-elses-record" }),
      "utf8",
    ).toString("base64url");

    const res = await get(`token=${encodeURIComponent(`${prefix}.${forged}.${signature}`)}`);
    const { json } = await body(res);
    assert.equal(json.verified, false);
  });

  it("refuses a token signed with a different secret", async () => {
    const res = await get(
      `token=${encodeURIComponent(signToken(validPayload(), "attacker-secret"))}`,
    );
    const { json } = await body(res);
    assert.equal(json.verified, false);
  });

  it("refuses a well-signed token whose record no longer exists", async () => {
    fileUploadFindUnique = recorder(() => null);

    const res = await get(`token=${encodeURIComponent(signToken(validPayload()))}`);
    const { json } = await body(res);
    assert.equal(json.verified, false);
    assert.equal(json.reason, "record_not_found");
  });

  it("fails closed when the signing secret is not configured", async () => {
    delete process.env.DOCUMENT_VERIFICATION_SECRET;

    const res = await get(`token=${encodeURIComponent(signToken(validPayload()))}`);
    const { json } = await body(res);
    assert.equal(json.verified, false);
    assert.ok(
      loggerCalls.some((c) => c.context?.alert === "document_verify_secret_missing"),
      "a verifier with no key must be loud, not quietly permissive",
    );
  });

  it("requires a token", async () => {
    const res = await get("");
    const { json } = await body(res);
    assert.equal(res.status, 400);
    assert.equal(json.verified, false);
  });
});

describe("document verifier — rate limiting", () => {
  it("refuses once the per-caller limit is exhausted", async () => {
    rateLimitAllows = false;

    const res = await get(`token=${encodeURIComponent(signToken(validPayload()))}`);
    assert.equal(res.status, 429);
    assert.equal(recordedQueries.length, 0, "a throttled request must not reach the database");
  });

  it("meters every caller, including ones with no token", async () => {
    await get("");
    assert.equal(rateLimitMock.mock.callCount(), 1);
  });
});

describe("document verifier — logging", () => {
  it("never writes a raw record identifier to the log", async () => {
    fileUploadFindUnique = recorder(() => null);
    await get(`token=${encodeURIComponent(signToken(validPayload()))}`);

    const serialized = JSON.stringify(loggerCalls);
    assert.ok(
      !serialized.includes(FILE_UPLOAD_ID),
      `log payload carried a raw record id: ${serialized}`,
    );
  });
});
