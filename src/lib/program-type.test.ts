import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PROGRAM_TYPES,
  isProgramType,
  normalizeProgramType,
  type ProgramType,
} from "./program-type";

describe("PROGRAM_TYPES", () => {
  it("contains exactly spokes, adult_ed, ietp in that order", () => {
    assert.deepEqual([...PROGRAM_TYPES], ["spokes", "adult_ed", "ietp"]);
  });

  it("values satisfy the exported ProgramType alias", () => {
    const forTypeCheck: readonly ProgramType[] = PROGRAM_TYPES;
    assert.equal(forTypeCheck.length, 3);
  });
});

describe("isProgramType", () => {
  it("accepts each known program value", () => {
    for (const value of PROGRAM_TYPES) {
      assert.equal(isProgramType(value), true, `expected ${value} to be valid`);
    }
  });

  it("rejects unknown strings", () => {
    assert.equal(isProgramType("SPOKES"), false);
    assert.equal(isProgramType("ged"), false);
    assert.equal(isProgramType(""), false);
    assert.equal(isProgramType("spokes "), false);
  });
});

describe("normalizeProgramType", () => {
  it("returns the value unchanged when valid", () => {
    assert.equal(normalizeProgramType("spokes"), "spokes");
    assert.equal(normalizeProgramType("adult_ed"), "adult_ed");
    assert.equal(normalizeProgramType("ietp"), "ietp");
  });

  it("falls back to spokes for null, undefined, or empty", () => {
    assert.equal(normalizeProgramType(null), "spokes");
    assert.equal(normalizeProgramType(undefined), "spokes");
    assert.equal(normalizeProgramType(""), "spokes");
  });

  it("falls back to spokes for unrecognized values", () => {
    assert.equal(normalizeProgramType("ged"), "spokes");
    assert.equal(normalizeProgramType("ADULT_ED"), "spokes");
    assert.equal(normalizeProgramType("foo"), "spokes");
  });
});
