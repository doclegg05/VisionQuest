import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("goal confirmation rules", () => {
  const CONFIRMABLE_FROM = ["active", "in_progress"];

  function canConfirm(currentStatus: string): boolean {
    return CONFIRMABLE_FROM.includes(currentStatus);
  }

  it("allows confirmation from active", () => {
    assert.equal(canConfirm("active"), true);
  });
  it("allows confirmation from in_progress", () => {
    assert.equal(canConfirm("in_progress"), true);
  });
  it("rejects confirmation from confirmed", () => {
    assert.equal(canConfirm("confirmed"), false);
  });
  it("rejects confirmation from completed", () => {
    assert.equal(canConfirm("completed"), false);
  });
  it("rejects confirmation from abandoned", () => {
    assert.equal(canConfirm("abandoned"), false);
  });
});
