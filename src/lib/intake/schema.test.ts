import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SIGNATURE_IMAGE_MAX_BYTES,
  intakePayloadSchema,
  parseSignatureImageDataUrl,
} from "./schema";

/** A 1x1 transparent PNG, the smallest thing a signature pad can produce. */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Marcus",
    lastName: "Miller",
    birthDate: "1998-04-15",
    county: "Fayette",
    ferpaConsentSigned: true,
    policyAcknowledgmentSigned: true,
    legalAffirmationSigned: true,
    signatureName: "Marcus Miller",
    signatureMethod: "typed_affirmation",
    ...overrides,
  };
}

function issuePaths(result: ReturnType<typeof intakePayloadSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("intakePayloadSchema", () => {
  it("accepts a complete valid intake payload", () => {
    const parsed = intakePayloadSchema.safeParse(
      validPayload({
        email: "marcus.miller@example.com",
        phone: "304-555-0199",
        householdType: "Single parent (1P)",
        gender: "Male",
        race: "Black or African American",
        educationalLevel: "High school diploma",
        programTrack: "Healthcare / CNA",
        tanfStatus: true,
        requiredParticipationHours: 20,
        referralSource: "DHHR / WV Works",
      }),
    );

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.firstName, "Marcus");
      assert.equal(parsed.data.county, "Fayette");
      assert.equal(parsed.data.tanfStatus, true);
    }
  });

  it("rejects an invalid county not in West Virginia", () => {
    const parsed = intakePayloadSchema.safeParse(validPayload({ county: "Cook" }));
    assert.equal(parsed.success, false);
    assert.ok(issuePaths(parsed).includes("county"));
  });

  it("rejects missing mandatory first or last name", () => {
    const parsed = intakePayloadSchema.safeParse(validPayload({ firstName: "   " }));
    assert.equal(parsed.success, false);
  });

  it("rejects unparseable birth date", () => {
    const parsed = intakePayloadSchema.safeParse(validPayload({ birthDate: "invalid-date-string" }));
    assert.equal(parsed.success, false);
  });

  // --- B5: an anonymous submitter must not be able to counter-sign as staff ---

  it("rejects a staff counter-signature supplied in the submitted payload", () => {
    const parsed = intakePayloadSchema.safeParse(
      validPayload({
        staffSignatureName: "Mallory Attacker",
        staffSignatureTitle: "SPOKES Lead Instructor",
        staffSignatureDataUrl: TINY_PNG,
        staffSignatureTimestamp: "2026-09-03T10:00:00.000Z",
        staffClearanceStatus: "approved",
      }),
    );

    assert.equal(parsed.success, false);
    const paths = issuePaths(parsed);
    for (const field of [
      "staffSignatureName",
      "staffSignatureTitle",
      "staffSignatureDataUrl",
      "staffSignatureTimestamp",
      "staffClearanceStatus",
    ]) {
      assert.ok(paths.includes(field), `${field} must be rejected, got issues: ${paths.join(", ")}`);
    }
  });

  it("rejects a self-declared clearance status even on its own", () => {
    const parsed = intakePayloadSchema.safeParse(validPayload({ staffClearanceStatus: "approved" }));
    assert.equal(parsed.success, false);
    assert.ok(issuePaths(parsed).includes("staffClearanceStatus"));
  });

  // --- H2: the audited party must not dictate its own audit trail ---

  it("rejects client-supplied signature forensics", () => {
    const parsed = intakePayloadSchema.safeParse(
      validPayload({
        signatureAuditHash: "SHA256:DEADBEEF",
        signatureIp: "203.0.113.9",
        signatureTimestamp: "1999-01-01T00:00:00.000Z",
      }),
    );

    assert.equal(parsed.success, false);
    const paths = issuePaths(parsed);
    for (const field of ["signatureAuditHash", "signatureIp", "signatureTimestamp"]) {
      assert.ok(paths.includes(field), `${field} must be rejected, got issues: ${paths.join(", ")}`);
    }
  });

  it("does not carry any server-derived forensics through to parsed data", () => {
    const parsed = intakePayloadSchema.safeParse(validPayload());
    assert.equal(parsed.success, true);
    if (parsed.success) {
      const keys = Object.keys(parsed.data);
      for (const field of [
        "signatureAuditHash",
        "signatureIp",
        "signatureTimestamp",
        "staffSignatureName",
        "staffClearanceStatus",
      ]) {
        assert.ok(!keys.includes(field), `${field} leaked into parsed data`);
      }
    }
  });

  // --- H4: consent is an affirmative act, never a default ---

  it("does not default FERPA consent or the policy acknowledgment to true", () => {
    const parsed = intakePayloadSchema.safeParse({
      firstName: "John",
      lastName: "Smith",
      birthDate: "1995-12-05",
      county: "Kanawha",
    });

    assert.equal(parsed.success, false);
    const paths = issuePaths(parsed);
    assert.ok(paths.includes("ferpaConsentSigned"));
    assert.ok(paths.includes("policyAcknowledgmentSigned"));
  });

  it("rejects a payload that explicitly declines consent", () => {
    const parsed = intakePayloadSchema.safeParse(
      validPayload({ ferpaConsentSigned: false, policyAcknowledgmentSigned: false }),
    );
    assert.equal(parsed.success, false);
  });

  // --- M15: signature images are bounded and MIME-checked ---

  it("accepts a small PNG signature image", () => {
    const parsed = intakePayloadSchema.safeParse(validPayload({ signatureDataUrl: TINY_PNG }));
    assert.equal(parsed.success, true);
  });

  it("rejects a signature data URL larger than the byte cap", () => {
    const oversized = `data:image/png;base64,${"A".repeat(Math.ceil((SIGNATURE_IMAGE_MAX_BYTES * 4) / 3) + 1024)}`;
    const parsed = intakePayloadSchema.safeParse(validPayload({ signatureDataUrl: oversized }));
    assert.equal(parsed.success, false);
    assert.ok(issuePaths(parsed).includes("signatureDataUrl"));
  });

  it("rejects a signature data URL whose MIME type is not an allowed image", () => {
    for (const hostile of [
      "data:image/svg+xml;base64,PHN2Zy8+",
      "data:text/html;base64,PHNjcmlwdD4x",
      "https://example.com/signature.png",
      "data:image/png,notbase64",
    ]) {
      const parsed = intakePayloadSchema.safeParse(validPayload({ signatureDataUrl: hostile }));
      assert.equal(parsed.success, false, `${hostile} must be rejected`);
    }
  });
});

describe("parseSignatureImageDataUrl", () => {
  it("reads the MIME type from the data URL header, never by sniffing the payload", () => {
    // The base64 body below decodes to text containing "image/jpeg". A substring
    // check over the whole data URL would call this a JPEG; the header says PNG.
    const smuggled = `data:image/png;base64,${Buffer.from("image/jpeg").toString("base64")}`;
    const parsed = parseSignatureImageDataUrl(smuggled);
    assert.ok(parsed);
    assert.equal(parsed.mimeType, "image/png");
  });

  it("returns null for anything that is not an allowed image data URL", () => {
    assert.equal(parseSignatureImageDataUrl(null), null);
    assert.equal(parseSignatureImageDataUrl(undefined), null);
    assert.equal(parseSignatureImageDataUrl(""), null);
    assert.equal(parseSignatureImageDataUrl("data:image/svg+xml;base64,PHN2Zy8+"), null);
    assert.equal(parseSignatureImageDataUrl(`data:image/png;base64,${"A".repeat(2_000_000)}`), null);
  });

  it("reports the decoded byte length so callers can bound the decoder", () => {
    const parsed = parseSignatureImageDataUrl(TINY_PNG);
    assert.ok(parsed);
    assert.equal(parsed.byteLength, Buffer.from(parsed.base64, "base64").length);
    assert.ok(parsed.byteLength <= SIGNATURE_IMAGE_MAX_BYTES);
  });
});
