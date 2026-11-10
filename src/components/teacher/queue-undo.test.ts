import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alertLineState,
  confirmQuestionFor,
  createQueueUndo,
  QUEUE_UNDO_WINDOW_MS,
  toastSnapshot,
  type QueueUndoDeps,
  type QueueUndoTarget,
} from "./queue-undo";

const LOW: QueueUndoTarget = { id: "a1", severity: "medium" };
const CRITICAL: QueueUndoTarget = { id: "w1", severity: "critical" };

interface Harness {
  deps: QueueUndoDeps;
  sent: Array<[string, string]>;
  confirms: string[];
  refreshes: () => number;
  timers: Array<{ ms: number; run: () => void; cancelled: boolean }>;
}

function harness(options: { failOn?: string; confirmAnswer?: boolean } = {}): Harness {
  const sent: Array<[string, string]> = [];
  const confirms: string[] = [];
  const timers: Harness["timers"] = [];
  let refreshCount = 0;
  const deps: QueueUndoDeps = {
    send: async (alertId, action) => {
      sent.push([alertId, action]);
      if (options.failOn === action) throw new Error("network down");
    },
    confirm: async (question) => {
      confirms.push(question.title);
      return options.confirmAnswer ?? true;
    },
    refresh: async () => {
      refreshCount += 1;
    },
    startTimer: (run, ms) => {
      const timer = { ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  return { deps, sent, confirms, refreshes: () => refreshCount, timers };
}

describe("createQueueUndo", () => {
  it("sends the action at once and opens an undo window of about 8 seconds", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    assert.deepEqual(h.sent, [["a1", "resolve"]]);
    assert.equal(flow.current().state.kind, "undoable");
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].ms, QUEUE_UNDO_WINDOW_MS);
    assert.equal(QUEUE_UNDO_WINDOW_MS, 8000);
    assert.equal(h.refreshes(), 0, "the row must not move while Undo is offered");
    assert.deepEqual(alertLineState(flow.current(), "a1"), { kind: "done", action: "resolve" });
  });

  it("undo inside the window sends reopen and keeps the alert in the queue", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "dismiss");
    await flow.undo();
    assert.deepEqual(h.sent, [
      ["a1", "dismiss"],
      ["a1", "reopen"],
    ]);
    assert.equal(h.timers[0].cancelled, true);
    assert.equal(flow.current().state.kind, "idle");
    assert.deepEqual(alertLineState(flow.current(), "a1"), { kind: "actions" });
    assert.equal(flow.current().message?.tone, "status");
    assert.equal(flow.current().message?.text, "The alert is back in your queue.");
  });

  it("when the window expires, Undo goes away and the queue refreshes", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    h.timers[0].run();
    await Promise.resolve();
    assert.equal(flow.current().state.kind, "idle");
    assert.equal(toastSnapshot(flow.current()), null);
    assert.equal(h.refreshes(), 1);
    await flow.undo();
    assert.deepEqual(h.sent, [["a1", "resolve"]], "no reopen after the window closed");
  });

  it("a failed action shows an alert message and leaves the alert where it was", async () => {
    const h = harness({ failOn: "resolve" });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    const snapshot = flow.current();
    assert.equal(snapshot.state.kind, "idle");
    assert.equal(snapshot.message?.tone, "alert");
    assert.match(snapshot.message?.text ?? "", /could not mark that alert resolved\. it is still in your queue/i);
    assert.deepEqual(alertLineState(snapshot, "a1"), { kind: "actions" });
    assert.equal(h.timers.length, 0);
    assert.equal(toastSnapshot(snapshot), null);
  });

  it("a failed undo says so plainly and shows the queue as it really is", async () => {
    const h = harness({ failOn: "reopen" });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "dismiss");
    await flow.undo();
    const snapshot = flow.current();
    assert.equal(snapshot.message?.tone, "alert");
    assert.match(snapshot.message?.text ?? "", /could not undo\. the alert is still dismissed/i);
    assert.equal(h.refreshes(), 1);
  });

  it("asks before acting on a critical alert, and does nothing when the answer is no", async () => {
    const h = harness({ confirmAnswer: false });
    const flow = createQueueUndo(h.deps);
    await flow.act(CRITICAL, "resolve");
    assert.deepEqual(h.confirms, ["Mark this alert as resolved?"]);
    assert.deepEqual(h.sent, []);
    assert.equal(flow.current().state.kind, "idle");
    assert.equal(flow.current().message, null);
    assert.deepEqual(alertLineState(flow.current(), "w1"), { kind: "actions" });
  });

  it("a confirmed critical action can still be undone", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(CRITICAL, "dismiss");
    assert.deepEqual(h.confirms, ["Dismiss this alert?"]);
    assert.equal(flow.current().state.kind, "undoable");
    await flow.undo();
    assert.deepEqual(h.sent.at(-1), ["w1", "reopen"]);
  });

  it("does not ask before acting on an alert that is not critical", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "dismiss");
    assert.deepEqual(h.confirms, []);
  });

  it("ignores a second tap while the first request is still out", async () => {
    const h = harness();
    let release: () => void = () => {};
    const slow: QueueUndoDeps = {
      ...h.deps,
      send: (alertId, action) => {
        h.sent.push([alertId, action]);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };
    const flow = createQueueUndo(slow);
    const first = flow.act(LOW, "resolve");
    await flow.act(LOW, "resolve");
    release();
    await first;
    assert.equal(h.sent.length, 1);
  });

  it("a new action ends the old window but keeps both rows still until the last window closes", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.act({ id: "a2", severity: "low" }, "dismiss");
    assert.equal(h.timers[0].cancelled, true);
    assert.equal(h.refreshes(), 0);
    assert.deepEqual(alertLineState(flow.current(), "a1"), { kind: "done", action: "resolve" });
    flow.finish();
    await Promise.resolve();
    assert.equal(h.refreshes(), 1);
  });

  it("closing the notice early ends the window", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    flow.finish();
    assert.equal(h.timers[0].cancelled, true);
    assert.equal(flow.current().state.kind, "idle");
  });
});

describe("toastSnapshot", () => {
  it("offers Undo with a plain label while the window is open", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    assert.deepEqual(
      { kind: toastSnapshot(flow.current())?.kind, label: toastSnapshot(flow.current())?.label },
      { kind: "pending", label: "Marked resolved." },
    );
  });
});

describe("confirmQuestionFor", () => {
  it("names what will happen in plain words", () => {
    assert.equal(confirmQuestionFor("resolve").title, "Mark this alert as resolved?");
    assert.match(confirmQuestionFor("resolve").message, /leave your queue/);
    assert.equal(confirmQuestionFor("dismiss").title, "Dismiss this alert?");
    assert.match(confirmQuestionFor("dismiss").message, /will not come back on its own/);
  });

  it("uses no dash characters in the copy", () => {
    for (const action of ["resolve", "dismiss"] as const) {
      const question = confirmQuestionFor(action);
      assert.doesNotMatch(`${question.title} ${question.message} ${question.confirmLabel}`, /[-–—]/);
    }
  });
});
