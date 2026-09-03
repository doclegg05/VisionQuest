import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { createStampedIntakePdfBuffer } from "./pdf-stamped-packet";
import type { IntakePayload } from "./schema";

describe("pdf-stamped-packet", () => {
  it("generates a valid, non-corrupt PDF with demographics and electronic signature block", async () => {
    const payload: IntakePayload = {
      firstName: "Darnell",
      lastName: "Washington",
      email: "darnell.w@example.com",
      phone: "304-555-0144",
      birthDate: "1994-07-22",
      county: "Nicholas",
      householdType: "Two parent (2P)",
      gender: "Male",
      race: "Black or African American",
      educationalLevel: "High school equivalency (GED/HSE)",
      programTrack: "Culinary / ServSafe",
      tanfStatus: true,
      requiredParticipationHours: 25,
      referralSource: "WV Works Nicholas County",
      notes: "Student has driver license and morning transportation.",
      ferpaConsentSigned: true,
      policyAcknowledgmentSigned: true,
      signatureName: "Darnell Washington",
      signatureTimestamp: "2026-09-03T10:00:00.000Z",
      signatureIp: "192.0.2.1",
    };

    const buffer = await createStampedIntakePdfBuffer(payload, "darnell.washington");

    assert.ok(buffer);
    assert.ok(buffer.length > 1000, "PDF buffer should contain binary data");

    // Verify PDF header magic bytes "%PDF-"
    const magic = buffer.subarray(0, 5).toString("utf8");
    assert.equal(magic, "%PDF-");

    // Verify that pdf-lib can parse and inspect the generated document
    const loadedDoc = await PDFDocument.load(new Uint8Array(buffer));
    assert.ok(loadedDoc.getPageCount() >= 1, "Should have at least 1 page");
  });

  it("embeds QR code and renders dual signatures when staff counter-signs", async () => {
    const samplePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const payload: IntakePayload = {
      firstName: "Morgan",
      lastName: "Vance",
      email: "morgan.vance@example.com",
      phone: "304-555-0199",
      birthDate: "1994-06-15",
      county: "Nicholas",
      householdType: "Two parent (2P)",
      tanfStatus: true,
      signatureName: "Morgan Vance",
      signatureDataUrl: samplePng,
      staffSignatureName: "Sarah Connor",
      staffSignatureTitle: "Lead SPOKES Coordinator",
      staffSignatureDataUrl: samplePng,
      staffClearanceStatus: "approved",
    };

    const buffer = await createStampedIntakePdfBuffer(payload, "morgan.vance");
    assert.ok(buffer);
    assert.ok(buffer.length > 50000, "PDF with QR and signatures should be well over 50KB");

    const loadedDoc = await PDFDocument.load(new Uint8Array(buffer));
    assert.ok(loadedDoc.getPageCount() >= 2, "Should have multiple pages including dual-signatures");
  });
});
