import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { intakePayloadSchema } from "./schema";

describe("intakePayloadSchema", () => {
  it("accepts a complete valid intake payload", () => {
    const payload = {
      firstName: "Marcus",
      lastName: "Miller",
      email: "marcus.miller@example.com",
      phone: "304-555-0199",
      birthDate: "1998-04-15",
      county: "Fayette",
      householdType: "Single parent (1P)",
      gender: "Male",
      race: "Black or African American",
      educationalLevel: "High school diploma",
      programTrack: "Healthcare / CNA",
      tanfStatus: true,
      requiredParticipationHours: 20,
      referralSource: "DHHR / WV Works",
      ferpaConsentSigned: true,
      policyAcknowledgmentSigned: true,
      signatureName: "Marcus Miller",
      signatureTimestamp: "2026-09-03T09:00:00.000Z",
    };

    const parsed = intakePayloadSchema.safeParse(payload);
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.firstName, "Marcus");
      assert.equal(parsed.data.county, "Fayette");
      assert.equal(parsed.data.tanfStatus, true);
    }
  });

  it("rejects an invalid county not in West Virginia", () => {
    const payload = {
      firstName: "Jane",
      lastName: "Doe",
      birthDate: "2000-01-01",
      county: "Cook", // Illinois, not WV
    };

    const parsed = intakePayloadSchema.safeParse(payload);
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      const countyError = parsed.error.issues.find((i) => i.path.includes("county"));
      assert.ok(countyError);
    }
  });

  it("rejects missing mandatory first or last name", () => {
    const payload = {
      firstName: "   ",
      lastName: "Doe",
      birthDate: "2000-01-01",
      county: "Nicholas",
    };

    const parsed = intakePayloadSchema.safeParse(payload);
    assert.equal(parsed.success, false);
  });

  it("rejects unparseable birth date", () => {
    const payload = {
      firstName: "John",
      lastName: "Smith",
      birthDate: "invalid-date-string",
      county: "Raleigh",
    };

    const parsed = intakePayloadSchema.safeParse(payload);
    assert.equal(parsed.success, false);
  });

  it("defaults ferpaConsentSigned and policyAcknowledgmentSigned to true if omitted", () => {
    const payload = {
      firstName: "John",
      lastName: "Smith",
      birthDate: "1995-12-05",
      county: "Kanawha",
    };

    const parsed = intakePayloadSchema.safeParse(payload);
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.ferpaConsentSigned, true);
      assert.equal(parsed.data.policyAcknowledgmentSigned, true);
      assert.equal(parsed.data.tanfStatus, false);
    }
  });
});
