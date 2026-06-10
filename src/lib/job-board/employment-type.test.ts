import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferEmploymentType } from "./employment-type";

describe("inferEmploymentType", () => {
  it("detects part-time from title or description", () => {
    assert.equal(inferEmploymentType({ title: "Cashier (Part-Time)" }), "part_time");
    assert.equal(inferEmploymentType({ title: "Aide", description: "PRN / per diem shifts" }), "part_time");
  });
  it("detects full-time", () => {
    assert.equal(inferEmploymentType({ title: "Full-Time Warehouse Associate" }), "full_time");
  });
  it("returns null when unknown", () => {
    assert.equal(inferEmploymentType({ title: "Administrative Assistant", description: "Office support." }), null);
  });
});
