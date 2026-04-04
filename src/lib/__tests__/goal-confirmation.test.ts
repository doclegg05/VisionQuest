import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("goal confirmation rules", () => {
  const CONFIRMABLE_FROM = ["active", "in_progress"];
  const NOT_CONFIRMABLE_FROM = ["confirmed", "completed", "abandoned", "blocked"];

  function canConfirm(currentStatus: string): boolean {
    return CONFIRMABLE_FROM.includes(currentStatus);
  }

  for (const status of CONFIRMABLE_FROM) {
    it(`allows confirmation from '${status}' status`, () => {
      assert.equal(canConfirm(status), true);
    });
  }

  for (const status of NOT_CONFIRMABLE_FROM) {
    it(`rejects confirmation from '${status}' status`, () => {
      assert.equal(canConfirm(status), false);
    });
  }
});
