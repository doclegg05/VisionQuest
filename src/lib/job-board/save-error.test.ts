import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeSaveError, SaveJobError } from "./save-error";

describe("describeSaveError (VQ-R-016)", () => {
  it("gives plain-language copy for a browse-pool / cross-class job", () => {
    const message = describeSaveError("not_your_class_board");
    assert.match(message, /class's board/i);
    assert.doesNotMatch(message, /undefined|null|\[object/i);
  });

  it("falls back to a generic try-again message for any other code", () => {
    assert.equal(describeSaveError("something_weird"), "We couldn't save that job. Try again.");
    assert.equal(describeSaveError(undefined), "We couldn't save that job. Try again.");
    assert.equal(describeSaveError(null), "We couldn't save that job. Try again.");
  });
});

describe("SaveJobError", () => {
  it("carries the code alongside the message", () => {
    const err = new SaveJobError("This job isn't on your class's board yet.", "not_your_class_board");
    assert.equal(err.message, "This job isn't on your class's board yet.");
    assert.equal(err.code, "not_your_class_board");
    assert.ok(err instanceof Error);
  });
});
