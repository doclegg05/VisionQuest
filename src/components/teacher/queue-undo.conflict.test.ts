/**
 * C10: Undo carries what it expects to undo, and a 409 from the alert route (another instructor changed the alert)
 * ends in a plain message and a reload, never a silent overwrite.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALERT_CHANGED_REFRESH_TEXT,
  ALERT_CHANGED_TEXT,
  ALREADY_SAVED,
  AlertChangedError,
  createQueueUndo,
  QUEUE_STATUS_ID,
  saveReceiptFrom,
  undoExpectationFrom,
} from "./queue-undo";
import { doneActions, harness, LOW, LOW2, offered } from "./queue-undo.test-support";

describe("Undo sends the state its save wrote", () => {
  it("passes the status and timestamp from the resolve answer to the reopen", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.undo();
    assert.deepEqual(h.sent, [["a1", "resolve"], ["a1", "reopen"]]);
    assert.deepEqual(h.expectations, [{ status: "resolved", at: "2026-11-11T10:00:00.000Z" }]);
  });

  it("passes the dismiss timestamp for a dismiss", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "dismiss");
    await flow.undo();
    assert.deepEqual(h.expectations, [{ status: "dismissed", at: "2026-11-11T10:00:00.000Z" }]);
  });

  it("offers no Undo when the save's answer says nothing it could expect", async () => {
    const h = harness({ noReceipt: true });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    assert.deepEqual(doneActions(flow), { a1: "resolve" });
    assert.equal(offered(flow, "a1"), false);
    await flow.undo();
    assert.deepEqual(h.sent, [["a1", "resolve"]], "no Undo may go out without an expected state");
  });
});

describe("another instructor changed the alert", () => {
  it("a refused Undo says so in plain words, ends the offer and reloads the queue", async () => {
    const h = harness({ conflictOn: "reopen" });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.undo();
    const snapshot = flow.current();
    assert.deepEqual(snapshot.message && { tone: snapshot.message.tone, text: snapshot.message.text }, {
      tone: "alert",
      text: "This alert changed. The list now shows the latest.",
    });
    assert.equal(snapshot.state.kind, "idle");
    assert.equal(h.refreshes(), 1);
    assert.deepEqual(doneActions(flow), {}, "the reload clears the stale done line");
    assert.equal(snapshot.focus?.elementId, QUEUE_STATUS_ID);
  });

  it("a refused Resolve says so and reloads, and marks nothing done", async () => {
    const h = harness({ conflictOn: "resolve" });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    const snapshot = flow.current();
    assert.equal(snapshot.message?.text, ALERT_CHANGED_TEXT);
    assert.equal(snapshot.state.kind, "idle");
    assert.deepEqual(doneActions(flow), {});
    assert.equal(h.refreshes(), 1);
  });

  // A reload lists only open alerts, so it would take away the line that holds the other alert's Undo.
  it("a refused Resolve keeps the Undo offered for another alert, and asks for a refresh instead", async () => {
    const h = harness({ conflictOnAlert: "a2" });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.act(LOW2, "resolve");
    assert.equal(offered(flow, "a1"), true);
    assert.equal(flow.current().message?.text, ALERT_CHANGED_REFRESH_TEXT);
    assert.equal(flow.current().message?.tone, "alert");
    assert.equal(h.refreshes(), 0);
    assert.deepEqual(doneActions(flow), { a1: "resolve" }, "Refresh list stays on screen");
    await flow.undo();
    assert.deepEqual(h.sent.at(-1), ["a1", "reopen"]);
  });

  it("a plain network failure on Undo still offers Undo again, with no reload", async () => {
    const h = harness({ failOn: "reopen" });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.undo();
    assert.equal(offered(flow, "a1"), true);
    assert.equal(h.refreshes(), 0);
    assert.notEqual(flow.current().message?.text, ALERT_CHANGED_TEXT);
  });
});

describe("a save the route says was already stored", () => {
  // The stamp in that answer may be another instructor's, so an Undo would reopen their decision.
  it("shows the alert as handled and offers no Undo", async () => {
    const h = harness({ alreadySavedOn: "a1" });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "dismiss");
    assert.deepEqual(doneActions(flow), { a1: "dismiss" });
    assert.equal(offered(flow, "a1"), false);
    assert.equal(flow.current().message?.text, "This alert was already dismissed.");
    assert.equal(flow.current().message?.tone, "status");
    await flow.undo();
    assert.deepEqual(h.sent, [["a1", "dismiss"]]);
  });

  it("keeps an Undo already offered for another alert", async () => {
    const h = harness({ alreadySavedOn: "a2" });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.act(LOW2, "resolve");
    assert.equal(offered(flow, "a1"), true);
    assert.equal(flow.current().message?.text, "This alert was already resolved.");
  });

  it("is read from the route's alreadySaved flag", () => {
    const answer = { status: "resolved", resolvedAt: "2026-11-11T10:00:00.000Z", alreadySaved: true };
    assert.equal(saveReceiptFrom("resolve", answer), ALREADY_SAVED);
    assert.deepEqual(saveReceiptFrom("resolve", { ...answer, alreadySaved: undefined }), {
      status: "resolved",
      at: "2026-11-11T10:00:00.000Z",
    });
  });
});

describe("snooze", () => {
  it("never offers an Undo, since reopen takes only a resolve or a dismiss", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "snooze");
    assert.equal(offered(flow, "a1"), false);
    await flow.undo();
    assert.deepEqual(h.sent, [["a1", "snooze"]]);
  });
});

describe("undoExpectationFrom", () => {
  it("reads the resolve and dismiss answers", () => {
    assert.deepEqual(undoExpectationFrom("resolve", { status: "resolved", resolvedAt: "2026-11-11T10:00:00.000Z" }), {
      status: "resolved",
      at: "2026-11-11T10:00:00.000Z",
    });
    assert.deepEqual(undoExpectationFrom("dismiss", { status: "dismissed", dismissedAt: "2026-11-11T10:00:00.000Z" }), {
      status: "dismissed",
      at: "2026-11-11T10:00:00.000Z",
    });
  });

  it("returns null for a snooze, a mismatched status or a missing timestamp", () => {
    assert.equal(undoExpectationFrom("snooze", { status: "snoozed", snoozedUntil: "2026-11-12T10:00:00.000Z" }), null);
    assert.equal(undoExpectationFrom("resolve", { status: "dismissed", dismissedAt: "2026-11-11T10:00:00.000Z" }), null);
    assert.equal(undoExpectationFrom("resolve", { status: "resolved" }), null);
    assert.equal(undoExpectationFrom("dismiss", null), null);
  });

  it("AlertChangedError is an Error the hook can throw for a 409", () => {
    assert.ok(new AlertChangedError() instanceof Error);
  });
});
