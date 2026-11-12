import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alertControlId, alertLineState, createQueueUndo, QUEUE_STATUS_ID, SNOOZE_HOURS } from "./queue-undo";
import {
  doneActions,
  harness,
  holding,
  landReload,
  LOW,
  LOW2,
  offered,
  settle,
  type Harness,
} from "./queue-undo.test-support";

describe("createQueueUndo: reloads", () => {
  it("a reload with no token clears every done line and the offer, as a class change needs", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.act(LOW2, "dismiss");
    flow.reloaded();
    assert.deepEqual(flow.current().done, {});
    assert.equal(flow.current().state.kind, "idle");
    await flow.undo();
    assert.equal(h.sent.filter(([, request]) => request === "reopen").length, 0);
  });

  it("a reload held open across an action leaves that action's line done and still undoable", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    const token = flow.beginReload();
    await flow.act(LOW2, "dismiss");
    flow.reloaded(token);
    assert.deepEqual(alertLineState(flow.current(), "a1"), { kind: "actions" }, "saved before the load began");
    assert.deepEqual(alertLineState(flow.current(), "a2"), {
      kind: "done",
      action: "dismiss",
      undoable: true,
      undoing: false,
    });
    await flow.undo();
    assert.deepEqual(h.sent.at(-1), ["a2", "reopen"]);
  });

  it("a reload begun after the action clears its line and its offer", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW2, "dismiss");
    landReload(flow);
    assert.deepEqual(alertLineState(flow.current(), "a2"), { kind: "actions" });
    assert.equal(flow.current().state.kind, "idle");
    await flow.undo();
    assert.deepEqual(h.sent, [["a2", "dismiss"]]);
  });

  it("a reload begun before the first action clears nothing", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    const token = flow.beginReload();
    await flow.act(LOW, "resolve");
    flow.reloaded(token);
    assert.equal(offered(flow, "a1"), true);
  });

  it("a reload that lands while a second action is out ends the earlier offer it could see", async () => {
    const h = harness();
    const held = holding(h, "dismiss");
    const flow = createQueueUndo(held.deps);
    await flow.act(LOW, "resolve");
    const token = flow.beginReload();
    const pending = flow.act(LOW2, "dismiss");
    flow.reloaded(token);
    held.fail();
    await pending;
    assert.equal(flow.current().state.kind, "idle", "the failed Dismiss has no earlier offer to give back");
    assert.deepEqual(doneActions(flow), {});
  });

  it("a reload that lands while a second action is out keeps an earlier offer it could not see", async () => {
    const h = harness();
    const held = holding(h, "dismiss");
    const flow = createQueueUndo(held.deps);
    const token = flow.beginReload();
    await flow.act(LOW, "resolve");
    const pending = flow.act(LOW2, "dismiss");
    flow.reloaded(token);
    held.fail();
    await pending;
    assert.equal(offered(flow, "a1"), true);
  });

  it("a reload with nothing to clear tells no listener", () => {
    const flow = createQueueUndo(harness().deps);
    let notified = 0;
    flow.subscribe(() => {
      notified += 1;
    });
    landReload(flow);
    flow.reloaded();
    assert.equal(notified, 0);
  });

  it("a snooze reloads the queue, and a good reload clears done lines and the offer", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.act(LOW2, "snooze");
    assert.deepEqual(h.sent.at(-1), ["a2", "snooze"]);
    assert.equal(h.refreshes(), 1);
    assert.deepEqual(flow.current().done, {});
    assert.equal(flow.current().state.kind, "idle");
    assert.equal(flow.current().message?.text, `Snoozed for ${SNOOZE_HOURS} hours.`);
  });

  it("a snoozed line shows as done, with no Undo, until the reload lands", async () => {
    const h = harness();
    let land: () => void = () => {};
    const flow = createQueueUndo({
      ...h.deps,
      refresh: (reload) => {
        const token = reload.beginReload();
        return new Promise<boolean>((resolve) => {
          land = () => {
            reload.reloaded(token);
            resolve(true);
          };
        });
      },
    });
    const pending = flow.act(LOW, "snooze");
    await settle();
    assert.deepEqual(alertLineState(flow.current(), "a1"), {
      kind: "done",
      action: "snooze",
      undoable: false,
      undoing: false,
    });
    assert.equal(flow.current().state.kind, "idle", "a snooze offers no Undo");
    land();
    await pending;
    assert.deepEqual(alertLineState(flow.current(), "a1"), { kind: "actions" });
  });

  it("a failed reload keeps the snoozed line done, and clears neither the done lines nor the offer", async () => {
    const h = harness({ refreshResult: false });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.act(LOW2, "snooze");
    assert.deepEqual(doneActions(flow), { a1: "resolve", a2: "snooze" });
    assert.equal(alertLineState(flow.current(), "a2").kind, "done", "no live pills on a snoozed alert");
    assert.equal(offered(flow, "a1"), true);
  });

  it("a rejected reload is caught and clears nothing", async () => {
    const h = harness({ refreshResult: "reject" });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.act(LOW2, "snooze");
    assert.deepEqual(doneActions(flow), { a1: "resolve", a2: "snooze" });
  });

  it("a failed snooze says so and keeps the earlier offer", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    h.failOnce("snooze");
    await flow.act(LOW2, "snooze");
    assert.equal(flow.current().message?.tone, "alert");
    assert.match(flow.current().message?.text ?? "", /could not snooze/i);
    assert.equal(offered(flow, "a1"), true);
    assert.deepEqual(alertLineState(flow.current(), "a2"), { kind: "actions" });
    assert.equal(h.refreshes(), 0);
  });
});

describe("createQueueUndo: a reload that lands while an Undo is out", () => {
  async function undoOut(action: "resolve" | "dismiss", h: Harness) {
    const held = holding(h, "reopen");
    const flow = createQueueUndo(held.deps);
    await flow.act(LOW, action);
    const pending = flow.undo();
    return { flow, held, pending };
  }

  it("keeps the line as it is until the Undo answers", async () => {
    const h = harness();
    const { flow, held, pending } = await undoOut("resolve", h);
    landReload(flow);
    assert.deepEqual(alertLineState(flow.current(), "a1"), {
      kind: "done",
      action: "resolve",
      undoable: true,
      undoing: true,
    });
    held.release();
    await pending;
  });

  it("reloads the queue after a successful Undo, so the alert shows again", async () => {
    const h = harness();
    const { flow, held, pending } = await undoOut("resolve", h);
    landReload(flow);
    held.release();
    await pending;
    assert.equal(h.refreshes(), 1, "the rows on screen were loaded while the alert was resolved");
    assert.equal(flow.current().state.kind, "idle");
    assert.deepEqual(flow.current().done, {});
    assert.equal(flow.current().message?.tone, "status");
    assert.equal(flow.current().message?.text, "The alert is back in your queue.");
    assert.equal(flow.current().focus?.elementId, QUEUE_STATUS_ID, "the line is not on screen to take focus");
  });

  it("drops the offer after a failed Undo and says the alert is still resolved", async () => {
    const h = harness();
    const { flow, held, pending } = await undoOut("resolve", h);
    landReload(flow);
    held.fail();
    await pending;
    assert.equal(flow.current().state.kind, "idle");
    assert.equal(offered(flow, "a1"), false);
    assert.equal(flow.current().message?.tone, "alert");
    assert.equal(flow.current().message?.text, "Could not undo. The alert is still resolved. Refresh the list.");
    assert.equal(flow.current().focus?.elementId, QUEUE_STATUS_ID);
    assert.equal(h.refreshes(), 0);
    await flow.undo();
    assert.equal(h.sent.filter(([, request]) => request === "reopen").length, 1, "no Undo is left to send");
    assert.deepEqual(doneActions(flow), { a1: "resolve" }, "held until a reload, so Refresh list stays on screen");
    landReload(flow);
    assert.deepEqual(flow.current().done, {});
  });

  it("says still dismissed for a dismissed alert", async () => {
    const h = harness();
    const { flow, held, pending } = await undoOut("dismiss", h);
    landReload(flow);
    held.fail();
    await pending;
    assert.equal(flow.current().message?.text, "Could not undo. The alert is still dismissed. Refresh the list.");
  });

  it("a class change while an Undo is out counts as that reload", async () => {
    const h = harness();
    const { flow, held, pending } = await undoOut("dismiss", h);
    flow.reloaded();
    held.fail();
    await pending;
    assert.equal(flow.current().state.kind, "idle");
    assert.match(flow.current().message?.text ?? "", /still dismissed/);
  });

  it("a reload begun before the action does not count: a failed Undo can be tried again", async () => {
    const h = harness();
    const held = holding(h, "reopen");
    const flow = createQueueUndo(held.deps);
    const token = flow.beginReload();
    await flow.act(LOW, "dismiss");
    const pending = flow.undo();
    flow.reloaded(token);
    held.fail();
    await pending;
    assert.equal(offered(flow, "a1"), true);
    assert.equal(flow.current().message?.text, "Could not undo. Try Undo again.");
    assert.equal(flow.current().focus?.elementId, alertControlId("a1", "undo"));
  });

  it("with no reload in between, a successful Undo does not reload", async () => {
    const h = harness();
    const { flow, held, pending } = await undoOut("resolve", h);
    held.release();
    await pending;
    assert.equal(h.refreshes(), 0);
    assert.equal(flow.current().focus?.elementId, alertControlId("a1", "resolve"));
  });
});

describe("createQueueUndo: Refresh list", () => {
  it("reloads the queue, and sends focus to the status line when the last done line clears", async () => {
    // The button shows only while a done line is held, so it leaves the screen with the last one.
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.refreshList();
    assert.equal(h.refreshes(), 1);
    assert.deepEqual(flow.current().done, {});
    assert.equal(flow.current().focus?.elementId, QUEUE_STATUS_ID);
  });

  it("leaves focus on the button when the load failed and the done lines are still held", async () => {
    const h = harness({ refreshResult: false });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    const before = flow.current().focus;
    await flow.refreshList();
    assert.equal(h.refreshes(), 1);
    assert.equal(offered(flow, "a1"), true);
    assert.equal(flow.current().focus, before, "the button is still there to try again");
  });

  it("moves no focus after the panel has unmounted", async () => {
    const h = harness();
    let land: () => void = () => {};
    const flow = createQueueUndo({
      ...h.deps,
      refresh: (reload) => {
        const token = reload.beginReload();
        return new Promise<boolean>((resolve) => {
          land = () => {
            reload.reloaded(token);
            resolve(true);
          };
        });
      },
    });
    await flow.act(LOW, "resolve");
    const before = flow.current().focus;
    const pending = flow.refreshList();
    flow.dispose();
    flow.connect();
    land();
    await pending;
    assert.equal(flow.current().focus, before);
  });
});
