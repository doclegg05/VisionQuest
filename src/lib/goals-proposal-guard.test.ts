import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAwaitingInstructorConfirmation } from "./goals";

// ---------------------------------------------------------------------------
// VQ-R-005 — one definition of "Sage proposed this and no human has confirmed
// it", shared by the API guard and the goals UI. Before this, the API blocked
// only `confirmed` while accepting `completed`, and the UI rendered live
// checkboxes on proposed weekly/task rows with no badge — so a single tap drove
// an AI-generated goal to done with no instructor involved.
// ---------------------------------------------------------------------------

describe("isAwaitingInstructorConfirmation (VQ-R-005)", () => {
  it("is true for an unconfirmed Sage proposal", () => {
    assert.equal(
      isAwaitingInstructorConfirmation({
        sourceMessageId: "msg-1",
        status: "proposed",
        confirmedAt: null,
      }),
      true,
    );
  });

  it("is false for a goal the student created themselves", () => {
    // Students may confirm and advance their own goals — the verification layer
    // exists to stop AI self-attestation, not to slow students down.
    assert.equal(
      isAwaitingInstructorConfirmation({
        sourceMessageId: null,
        status: "proposed",
        confirmedAt: null,
      }),
      false,
    );
  });

  it("is false once an instructor has confirmed it", () => {
    assert.equal(
      isAwaitingInstructorConfirmation({
        sourceMessageId: "msg-1",
        status: "confirmed",
        confirmedAt: new Date("2026-07-01"),
      }),
      false,
    );
  });

  it("is false when confirmedAt is set even if status moved on", () => {
    // A confirmed goal that the student has since advanced to in_progress is
    // theirs to work; the gate is "until confirmed", not "forever".
    assert.equal(
      isAwaitingInstructorConfirmation({
        sourceMessageId: "msg-1",
        status: "in_progress",
        confirmedAt: new Date("2026-07-01"),
      }),
      false,
    );
  });

  it("accepts a serialized date string, so the client and server agree", () => {
    // The client receives confirmedAt as JSON, not a Date.
    assert.equal(
      isAwaitingInstructorConfirmation({
        sourceMessageId: "msg-1",
        status: "in_progress",
        confirmedAt: "2026-07-01T00:00:00.000Z",
      }),
      false,
    );
    assert.equal(
      isAwaitingInstructorConfirmation({
        sourceMessageId: "msg-1",
        status: "proposed",
        confirmedAt: null,
      }),
      true,
    );
  });

  it("treats a missing sourceMessageId field as student-created", () => {
    assert.equal(isAwaitingInstructorConfirmation({ status: "proposed" }), false);
  });
});
