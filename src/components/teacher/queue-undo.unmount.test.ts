import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alertControlId, alertLineState, createQueueUndo, type UndoExpectation } from "./queue-undo";
import {
  CRITICAL,
  doneActions,
  harness,
  holding,
  landReload,
  LOW,
  LOW2,
  offered,
  withOpenConfirm,
  receiptFor,
} from "./queue-undo.test-support";

describe("createQueueUndo: unmount", () => {
  it("a send in flight at unmount starts nothing and does not reload afterwards", async () => {
    const h = harness();
    let release: () => void = () => {};
    let notified = 0;
    const flow = createQueueUndo({
      ...h.deps,
      send: (alertId, action) => {
        h.sent.push([alertId, action]);
        return new Promise<UndoExpectation | null>((resolve) => {
          release = () => resolve(receiptFor(action));
        });
      },
    });
    flow.subscribe(() => {
      notified += 1;
    });
    const pending = flow.act(LOW, "snooze");
    const before = notified;
    flow.dispose();
    release();
    await pending;
    assert.equal(h.refreshes(), 0);
    assert.equal(notified, before);
    await flow.act(LOW2, "resolve");
    assert.equal(h.sent.length, 1, "a disposed flow sends nothing new");
  });

  it("connect after dispose makes the flow work again, as React's dev double mount needs", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    flow.dispose();
    flow.connect();
    await flow.act(LOW, "resolve");
    assert.equal(offered(flow, "a1"), true);
  });

  it("a confirm answered after unmount sends nothing", async () => {
    const h = harness();
    let answer: (yes: boolean) => void = () => {};
    const flow = createQueueUndo({
      ...h.deps,
      confirm: () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    });
    const pending = flow.act(CRITICAL, "dismiss");
    flow.dispose();
    answer(true);
    await pending;
    assert.deepEqual(h.sent, []);
  });

  it("a Resolved in flight at unmount changes nothing when its answer lands", async () => {
    const h = harness();
    const held = holding(h, "resolve");
    const flow = createQueueUndo(held.deps);
    let notified = 0;
    flow.subscribe(() => {
      notified += 1;
    });
    const pending = flow.act(LOW, "resolve");
    const before = notified;
    flow.dispose();
    held.release();
    await pending;
    assert.equal(notified, before);
    assert.deepEqual(flow.current().done, {});
    assert.equal(flow.current().focus, null, "no focus move on a page that is gone");
    assert.equal(h.refreshes(), 0);
  });

  it("an Undo in flight at unmount changes nothing and reloads nothing", async () => {
    const h = harness();
    const held = holding(h, "reopen");
    const flow = createQueueUndo(held.deps);
    await flow.act(LOW, "dismiss");
    let notified = 0;
    flow.subscribe(() => {
      notified += 1;
    });
    const pending = flow.undo();
    // A reload landed first, so a successful Undo would reload the queue if the panel were still there.
    landReload(flow);
    const before = notified;
    const message = flow.current().message;
    flow.dispose();
    held.release();
    await pending;
    assert.equal(notified, before);
    assert.equal(flow.current().message, message);
    assert.deepEqual(doneActions(flow), { a1: "dismiss" });
    assert.equal(h.refreshes(), 0);
  });

  it("connect after an answer was dropped leaves no request behind, and keeps the done lines", async () => {
    const h = harness();
    const held = holding(h, "dismiss");
    const flow = createQueueUndo(held.deps);
    await flow.act(LOW, "resolve");
    const pending = flow.act(LOW2, "dismiss");
    flow.dispose();
    held.release();
    await pending;
    flow.connect();
    assert.equal(flow.current().state.kind, "idle");
    assert.equal(flow.canAct(), true, "the flow is not stuck");
    assert.deepEqual(alertLineState(flow.current(), "a1"), {
      kind: "done",
      action: "resolve",
      undoable: false,
      undoing: false,
    });
    assert.deepEqual(alertLineState(flow.current(), "a2"), { kind: "actions" });
    await flow.act(CRITICAL, "resolve");
    assert.equal(offered(flow, "w1"), true, "the next tap is taken");
  });

  it("connect with a request still in flight goes back to idle, and the late answer changes nothing", async () => {
    const h = harness();
    const held = holding(h, "resolve");
    const flow = createQueueUndo(held.deps);
    const pending = flow.act(LOW, "resolve");
    flow.dispose();
    flow.connect();
    assert.equal(flow.current().state.kind, "idle");
    await flow.act(LOW2, "dismiss");
    assert.equal(offered(flow, "a2"), true);
    held.release();
    await pending;
    assert.equal(offered(flow, "a2"), true, "the old answer did not take the offer");
    assert.deepEqual(doneActions(flow), { a2: "dismiss" });
    assert.equal(flow.current().focus?.elementId, alertControlId("a2", "undo"));
  });

  it("connect with a failed request still in flight shows no late failure", async () => {
    const h = harness();
    const held = holding(h, "resolve");
    const flow = createQueueUndo(held.deps);
    const pending = flow.act(LOW, "resolve");
    flow.dispose();
    flow.connect();
    held.fail();
    await pending;
    assert.equal(flow.current().message, null);
    assert.equal(flow.current().state.kind, "idle");
  });

  it("connect with an Undo still in flight ends the offer and keeps the done line", async () => {
    const h = harness();
    const held = holding(h, "reopen");
    const flow = createQueueUndo(held.deps);
    await flow.act(LOW, "dismiss");
    const pending = flow.undo();
    flow.dispose();
    flow.connect();
    assert.equal(flow.current().state.kind, "idle");
    assert.deepEqual(alertLineState(flow.current(), "a1"), {
      kind: "done",
      action: "dismiss",
      undoable: false,
      undoing: false,
    });
    held.release();
    await pending;
    assert.deepEqual(doneActions(flow), { a1: "dismiss" }, "the late answer changed nothing");
    assert.equal(h.refreshes(), 0);
  });

  it("connect with a confirm still open goes back to idle, and a late yes sends nothing", async () => {
    const h = harness();
    const { flow, answer } = withOpenConfirm(h);
    const pending = flow.act(CRITICAL, "dismiss");
    flow.dispose();
    flow.connect();
    assert.equal(flow.current().state.kind, "idle");
    answer(true);
    await pending;
    assert.deepEqual(h.sent, []);
  });

  it("connect tells no listener when nothing was in flight", () => {
    const flow = createQueueUndo(harness().deps);
    let notified = 0;
    flow.subscribe(() => {
      notified += 1;
    });
    flow.dispose();
    flow.connect();
    assert.equal(notified, 0);
  });
});
