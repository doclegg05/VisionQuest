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
});
