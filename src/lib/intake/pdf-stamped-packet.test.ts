import assert from "node:assert/strict";
import crypto from "node:crypto";
import { before, beforeEach, describe, it, mock } from "node:test";
import { PDFArray, PDFDocument, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";
import type { IntakePayload } from "./schema";

// --- persistence boundary fakes -------------------------------------------------

interface UpsertArgs {
  where: unknown;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

// The verifier's HMAC needs a >=32 char secret; without it the packet ships
// with no QR code, which would hide the token wiring from these tests.
process.env.DOCUMENT_VERIFICATION_SECRET = "test-document-verification-secret-0123456789";

const uploads: Array<{ key: string; bytes: number; mimeType: string }> = [];
const fileUploadCreate = mock.fn(async (args: { data: Record<string, unknown> }) => ({
  ...args.data,
  id: String(args.data.id ?? "file_test_1"),
}));
const fileUploadUpdate = mock.fn(
  async (_args: { where: { id: string }; data: Record<string, unknown> }) => ({ id: "file_test_1" }),
);
const formSubmissionUpsert = mock.fn(async (_args: UpsertArgs) => ({ id: "submission_test_1" }));
const formResponseUpsert = mock.fn(async (_args: UpsertArgs) => ({ id: "response_test_1" }));

mock.module("@/lib/storage", {
  namedExports: {
    uploadFile: async (key: string, buffer: Buffer, mimeType: string) => {
      uploads.push({ key, bytes: buffer.length, mimeType });
    },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      fileUpload: { create: fileUploadCreate, update: fileUploadUpdate },
      formSubmission: { upsert: formSubmissionUpsert },
      formResponse: { upsert: formResponseUpsert },
    },
  },
});

let packet: typeof import("./pdf-stamped-packet");

before(async () => {
  packet = await import("./pdf-stamped-packet");
});

// --- helpers --------------------------------------------------------------------

/**
 * Pull the visible text out of a generated packet. pdf-lib writes every
 * `drawText` call as a hex string in a Flate-compressed content stream, so the
 * bytes cannot simply be grepped.
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const doc = await PDFDocument.load(new Uint8Array(buffer));
  const streams: string[] = [];

  for (const page of doc.getPages()) {
    const context = page.node.context;
    const contents = page.node.Contents();
    const entries = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const entry of entries) {
      const resolved = entry instanceof PDFRef ? context.lookup(entry) : entry;
      if (resolved instanceof PDFRawStream) {
        streams.push(Buffer.from(decodePDFRawStream(resolved).decode()).toString("latin1"));
      }
    }
  }

  const joined = streams.join("\n");
  const literals = [...joined.matchAll(/\(((?:\\.|[^\\()])*)\)\s*(?:Tj|TJ)/g)].map((m) =>
    m[1].replace(/\\([()\\])/g, "$1"),
  );
  const hexStrings = [...joined.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)].map((m) =>
    Buffer.from(m[1].replace(/\s+/g, ""), "hex").toString("latin1"),
  );

  return [...literals, ...hexStrings].join("\n");
}

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** A packet the student really did sign. */
function signedPayload(overrides: Record<string, unknown> = {}): IntakePayload {
  return {
    firstName: "Morgan",
    lastName: "Vance",
    email: "morgan.vance@example.com",
    phone: "304-555-0199",
    birthDate: "1994-06-15",
    county: "Nicholas",
    householdType: "Two parent (2P)",
    tanfStatus: true,
    ferpaConsentSigned: true,
    policyAcknowledgmentSigned: true,
    legalAffirmationSigned: true,
    signatureName: "Morgan Vance",
    signatureMethod: "drawn",
    signatureDataUrl: TINY_PNG,
    ...overrides,
  } as IntakePayload;
}

/**
 * What a hostile anonymous POST would look like if the request schema were
 * bypassed: the forensics and the instructor counter-signature all supplied by
 * the submitter.
 */
function forgedPayload(): IntakePayload {
  return signedPayload({
    signatureAuditHash: "SHA256:DEADBEEFDEADBEEFDEADBEEFDEADBEEF",
    signatureIp: "203.0.113.9",
    signatureTimestamp: "1999-01-01T00:00:00.000Z",
    staffSignatureName: "Mallory Attacker",
    staffSignatureTitle: "SPOKES Lead Instructor",
    staffSignatureDataUrl: TINY_PNG,
    staffSignatureTimestamp: "1999-01-01T00:00:00.000Z",
    staffClearanceStatus: "approved",
  });
}

const PROCEDURAL = { templatePath: null } as const;

describe("createStampedIntakePacket", () => {
  it("generates a valid, non-corrupt PDF", async () => {
    const { buffer } = await packet.createStampedIntakePacket(
      signedPayload({
        race: "Black or African American",
        educationalLevel: "High school equivalency (GED/HSE)",
        programTrack: "Culinary / ServSafe",
        requiredParticipationHours: 25,
        referralSource: "WV Works Nicholas County",
        notes: "Student has driver license and morning transportation.",
      }),
      "morgan.vance",
      PROCEDURAL,
    );

    assert.ok(buffer.length > 1000, "PDF buffer should contain binary data");
    assert.equal(buffer.subarray(0, 5).toString("utf8"), "%PDF-");
    const loaded = await PDFDocument.load(new Uint8Array(buffer));
    assert.ok(loaded.getPageCount() >= 1);
  });

  // --- B5 -----------------------------------------------------------------------

  it("never renders an instructor counter-signature from the submitted payload", async () => {
    const { buffer, attestation } = await packet.createStampedIntakePacket(
      forgedPayload(),
      "morgan.vance",
      PROCEDURAL,
    );
    const text = await extractPdfText(buffer);

    assert.equal(attestation.staffCounterSigned, false);
    assert.ok(!text.includes("Mallory Attacker"), "payload-supplied staff name reached the packet");
    assert.ok(!text.includes("APPROVED & ENROLLED"), "payload self-approved the clearance block");
    assert.ok(text.includes("PENDING INSTRUCTOR REVIEW"));
  });

  it("renders the counter-signature only when an authenticated staff signature is passed", async () => {
    const { buffer, attestation } = await packet.createStampedIntakePacket(
      signedPayload(),
      "morgan.vance",
      {
        ...PROCEDURAL,
        staffCounterSignature: {
          name: "Sarah Connor",
          title: "Lead SPOKES Coordinator",
          reviewerId: "staff_cuid_1",
          signatureDataUrl: TINY_PNG,
        },
      },
    );
    const text = await extractPdfText(buffer);

    assert.equal(attestation.staffCounterSigned, true);
    assert.ok(text.includes("APPROVED & ENROLLED"));
    assert.ok(text.includes("Sarah Connor"));
    assert.ok(text.includes("Lead SPOKES Coordinator"));
  });

  // --- H2 -----------------------------------------------------------------------

  it("prints a verification id that is not a reversible encoding of the signer", async () => {
    const { buffer, attestation } = await packet.createStampedIntakePacket(
      signedPayload(),
      "morgan.vance",
      PROCEDURAL,
    );
    const text = await extractPdfText(buffer);

    // The pre-hardening "digest" was hex of `name:timestamp:studentId`.
    const reversible = Buffer.from(attestation.fileUploadId.slice(1), "hex").toString("latin1");
    assert.ok(!reversible.includes("Morgan"), "verification id decodes back to the signer's name");
    assert.ok(!reversible.includes("Vance"));
    assert.ok(!reversible.includes("morgan.vance"));
    assert.ok(!text.includes("Audit Certificate Digest"), "reversible plaintext digest is still printed");
    assert.ok(text.includes(`Verification ID: ${attestation.fileUploadId}`));
  });

  it("issues an unguessable verification id per packet", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const { attestation } = await packet.createStampedIntakePacket(
        signedPayload(),
        "morgan.vance",
        PROCEDURAL,
      );
      assert.match(attestation.fileUploadId, /^c[0-9a-f]{24}$/, "verification id is not cuid-shaped");
      ids.add(attestation.fileUploadId);
    }
    assert.equal(ids.size, 3, "verification ids repeat for identical input");
  });

  it("stamps a signed verification token that binds the archived file id", async () => {
    const { attestation } = await packet.createStampedIntakePacket(
      signedPayload(),
      "morgan.vance",
      PROCEDURAL,
    );

    const token = attestation.verificationToken;
    assert.ok(token, "no verification token was issued");
    const [version, segment, signature] = token.split(".");
    assert.equal(version, "vqd1");

    const payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    assert.equal(payload.v, 1);
    assert.equal(payload.fid, attestation.fileUploadId);

    const expected = crypto
      .createHmac("sha256", process.env.DOCUMENT_VERIFICATION_SECRET as string)
      .update(`vqd1.${segment}`)
      .digest("base64url");
    assert.equal(signature, expected);

    // The version is inside the MAC, so a v2 token cannot be replayed as v1.
    const downgraded = crypto
      .createHmac("sha256", process.env.DOCUMENT_VERIFICATION_SECRET as string)
      .update(segment)
      .digest("base64url");
    assert.notEqual(signature, downgraded);
  });

  it("refuses to sign a verification token without a configured secret", () => {
    const original = process.env.DOCUMENT_VERIFICATION_SECRET;
    process.env.DOCUMENT_VERIFICATION_SECRET = "too-short";
    try {
      assert.throws(() => packet.signDocumentVerificationToken("cfileid"), /DOCUMENT_VERIFICATION_SECRET/);
    } finally {
      process.env.DOCUMENT_VERIFICATION_SECRET = original;
    }
  });

  it("returns a real SHA-256 digest over the finished PDF bytes", async () => {
    const { buffer, attestation } = await packet.createStampedIntakePacket(
      signedPayload(),
      "morgan.vance",
      PROCEDURAL,
    );

    assert.equal(attestation.algorithm, "sha256");
    assert.equal(attestation.digest, crypto.createHash("sha256").update(buffer).digest("hex"));
    assert.equal(packet.computePacketDigest(buffer), attestation.digest);

    const tampered = Buffer.from(buffer);
    tampered[tampered.length - 20] ^= 0xff;
    assert.notEqual(packet.computePacketDigest(tampered), attestation.digest);
  });

  it("derives the audit trail server-side and ignores client-supplied forensics", async () => {
    const sourceIp = "198.51.100.7";
    const { buffer, attestation } = await packet.createStampedIntakePacket(
      forgedPayload(),
      "morgan.vance",
      { ...PROCEDURAL, signature: { sourceIp } },
    );
    const text = await extractPdfText(buffer);

    assert.ok(!text.includes("1999-01-01"), "client-supplied signing time reached the packet");
    assert.ok(!text.includes("203.0.113.9"), "client-supplied source IP reached the packet");
    assert.ok(!text.includes("DEADBEEF"), "client-supplied digest reached the packet");
    assert.ok(text.includes(attestation.signedAt.toISOString()));
    assert.ok(text.includes(sourceIp));
    assert.equal(attestation.sourceIp, sourceIp);
  });

  it("records 'not recorded' rather than inventing a source when no IP is available", async () => {
    const { buffer, attestation } = await packet.createStampedIntakePacket(
      signedPayload(),
      "morgan.vance",
      PROCEDURAL,
    );
    const text = await extractPdfText(buffer);

    assert.equal(attestation.sourceIp, null);
    assert.ok(!text.includes("Verified Secure Student Portal"));
    assert.ok(text.includes("not recorded"));
  });

  it("prints the legal declaration only for an attestation that actually happened", async () => {
    const signed = await packet.createStampedIntakePacket(signedPayload(), "morgan.vance", PROCEDURAL);
    const signedText = await extractPdfText(signed.buffer);
    assert.equal(signed.attestation.studentAttested, true);
    assert.ok(signedText.includes("FERPA 34 CFR"));
    assert.ok(signedText.includes("E-SIGN Act"));

    const unsigned = await packet.createStampedIntakePacket(
      signedPayload({
        ferpaConsentSigned: undefined,
        policyAcknowledgmentSigned: undefined,
        legalAffirmationSigned: undefined,
        signatureName: undefined,
        signatureDataUrl: undefined,
        signatureMethod: undefined,
      }),
      "morgan.vance",
      PROCEDURAL,
    );
    const unsignedText = await extractPdfText(unsigned.buffer);
    assert.equal(unsigned.attestation.studentAttested, false);
    assert.ok(
      !unsignedText.includes("Legal Declaration"),
      "an unsigned packet still claims a verified electronic signature",
    );
    assert.ok(unsignedText.includes("NO ELECTRONIC SIGNATURE ON RECORD"));
  });

  it("keeps the official state template honest about an unsigned packet", async () => {
    const { buffer } = await packet.createStampedIntakePacket(
      signedPayload({
        ferpaConsentSigned: undefined,
        policyAcknowledgmentSigned: undefined,
        signatureName: undefined,
        signatureDataUrl: undefined,
        signatureMethod: undefined,
      }),
      "morgan.vance",
    );
    const text = await extractPdfText(buffer);

    assert.ok(
      !text.includes("OFFICIAL STATE VERIFICATION"),
      "the state audit certificate is stamped on an unsigned packet",
    );
    assert.ok(!text.includes("Consent Verified & Recorded"));
    assert.ok(text.includes("NO ELECTRONIC SIGNATURE ON RECORD"));
  });
});

describe("saveStampedIntakePacket", () => {
  beforeEach(() => {
    uploads.length = 0;
    fileUploadCreate.mock.resetCalls();
    fileUploadUpdate.mock.resetCalls();
    formSubmissionUpsert.mock.resetCalls();
    formResponseUpsert.mock.resetCalls();
  });

  it("never self-approves a self-submitted intake packet", async () => {
    const result = await packet.saveStampedIntakePacket(
      "student_db_1",
      "morgan.vance",
      forgedPayload(),
    );

    assert.equal(formSubmissionUpsert.mock.callCount(), 1);
    const args = formSubmissionUpsert.mock.calls[0].arguments[0];
    assert.equal(args.create.status, "pending", "a self-submitted packet was persisted as approved");
    assert.equal(args.create.reviewedBy ?? null, null);
    assert.notEqual(args.update.status, "approved", "regeneration can silently approve a submission");
    assert.equal(result.attestation.staffCounterSigned, false);
  });

  it("records the reviewer when an authenticated staff member counter-signs", async () => {
    await packet.saveStampedIntakePacket("student_db_1", "morgan.vance", signedPayload(), {
      staffCounterSignature: {
        name: "Sarah Connor",
        title: "Lead SPOKES Coordinator",
        reviewerId: "staff_cuid_1",
      },
    });

    const args = formSubmissionUpsert.mock.calls[0].arguments[0];
    assert.equal(args.create.status, "approved");
    assert.equal(args.create.reviewedBy, "staff_cuid_1");
    assert.equal(args.update.status, "approved");
    assert.equal(args.update.reviewedBy, "staff_cuid_1");
  });

  it("returns the attestation and keys storage by the verification id", async () => {
    const result = await packet.saveStampedIntakePacket(
      "student_db_1",
      "morgan.vance",
      signedPayload(),
    );

    assert.equal(uploads.length, 1);
    assert.ok(uploads[0].key.includes(result.attestation.fileUploadId));
    assert.equal(result.storageKey, uploads[0].key);
    assert.equal(result.attestation.digest.length, 64);

    // The row is filed under the id the printed token already binds.
    const created = fileUploadCreate.mock.calls[0].arguments[0].data;
    assert.equal(created.id, result.attestation.fileUploadId);
    assert.equal(result.fileUploadId, result.attestation.fileUploadId);

    // ...and the digest of the archived bytes is recorded against it.
    assert.equal(fileUploadUpdate.mock.callCount(), 1);
    const digestWrite = fileUploadUpdate.mock.calls[0].arguments[0];
    assert.equal(digestWrite.where.id, result.attestation.fileUploadId);
    assert.equal(digestWrite.data.contentDigest, result.attestation.digest);
  });
});
