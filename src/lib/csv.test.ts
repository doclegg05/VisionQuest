import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeCsvValue } from "./csv";

describe("escapeCsvValue", () => {
  it("prefixes dangerous spreadsheet formulas", () => {
    assert.equal(escapeCsvValue("=2+2"), "'=2+2");
    assert.equal(escapeCsvValue("  +SUM(A1:A2)"), "'  +SUM(A1:A2)");
  });

  it("still quotes values that contain commas", () => {
    assert.equal(escapeCsvValue("Doe, Jane"), '"Doe, Jane"');
  });

  it("prefixes tab- and CR-led cells and quotes an embedded carriage return", () => {
    assert.equal(escapeCsvValue("\t=1+1"), "'\t=1+1");
    assert.equal(escapeCsvValue("\r=1+1"), "\"'\r=1+1\"");
    assert.equal(escapeCsvValue("line1\rline2"), '"line1\rline2"');
  });
});
