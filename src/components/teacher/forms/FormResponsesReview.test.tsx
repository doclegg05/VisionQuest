import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runReview } from "./FormResponsesReview";

/**
 * HIG review g10 round 1: a failed review used to land in an alert outside
 * the modal <dialog>, where showModal() made it inert and silent. The drawer
 * now shows the failure itself; runReview is the decision behind that notice.
 */
describe("runReview", () => {
  it("returns null when the review succeeds, so no notice shows", async () => {
    assert.equal(await runReview(async () => {}), null);
  });

  it("returns the server's message when the review fails", async () => {
    const message = await runReview(async () => {
      throw new Error("Add a note before sending this back.");
    });
    assert.equal(message, "Add a note before sending this back.");
  });

  it("falls back to a plain message when the failure is not an Error", async () => {
    const message = await runReview(async () => {
      throw "network down";
    });
    assert.equal(message, "Review failed.");
  });
});
