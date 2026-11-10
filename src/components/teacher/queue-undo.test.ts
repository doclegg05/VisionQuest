import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  alertControlId,
  alertLineState,
  confirmQuestionFor,
  createQueueUndo,
  doneLabel,
  QUEUE_STATUS_ID,
  SNOOZE_HOURS,
  type QueueSendRequest,
  type QueueUndoDeps,
  type QueueUndoTarget,
} from "./queue-undo";

const LOW: QueueUndoTarget = { id: "a1", severity: "medium", title: "Goal review", studentName: "Sam Rivera" };
const LOW2: QueueUndoTarget = { id: "a2", severity: "low", title: "Missing form", studentName: "Ana Lopez" };
const CRITICAL: QueueUndoTarget = {
  id: "w1",
  severity: "critical",
  title: "Wellbeing check",
  studentName: "Jo Park",
};

interface Harness {
  deps: QueueUndoDeps;
  sent: Array<[string, QueueSendRequest]>;
  confirms: Array<{ title: string; message: string }>;
  refreshes: () => number;
  /** Fail the next send of this request once, then let it succeed. */
  failOnce: (request: QueueSendRequest) => void;
}

interface HarnessOptions {
  failOn?: QueueSendRequest;
  confirmAnswer?: boolean;
  refreshResult?: boolean | "reject";
}

function harness(options: HarnessOptions = {}): Harness {
  const sent: Harness["sent"] = [];
  const confirms: Harness["confirms"] = [];
  const failNext = new Set<QueueSendRequest>();
  let refreshCount = 0;
  const deps: QueueUndoDeps = {
    send: async (alertId, request) => {
      sent.push([alertId, request]);
      if (options.failOn === request || failNext.delete(request)) throw new Error("network down");
    },
    confirm: async (question) => {
      confirms.push({ title: question.title, message: question.message });
      return options.confirmAnswer ?? true;
    },
    refresh: async () => {
      refreshCount += 1;
      if (options.refreshResult === "reject") throw new Error("offline");
      return options.refreshResult ?? true;
    },
  };
  return {
    deps,
    sent,
    confirms,
    refreshes: () => refreshCount,
    failOnce: (request) => {
      failNext.add(request);
    },
  };
}

function offered(flow: ReturnType<typeof createQueueUndo>, alertId: string): boolean {
  const line = alertLineState(flow.current(), alertId);
  return line.kind === "done" && line.undoable;
}

describe("createQueueUndo: Resolved and Dismiss", () => {
  it("sends the action at once, marks the line done and offers Undo, with no reload", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    assert.deepEqual(h.sent, [["a1", "resolve"]]);
    assert.equal(flow.current().state.kind, "undoable");
    assert.equal(h.refreshes(), 0, "a Resolve must not reload the queue, so no row moves");
    assert.deepEqual(alertLineState(flow.current(), "a1"), {
      kind: "done",
      action: "resolve",
      undoable: true,
      undoing: false,
    });
  });

  it("starts no timer: the flow takes no startTimer dependency", () => {
    const source = readFileSync(new URL("./queue-undo.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /startTimer|setTimeout|QUEUE_UNDO_WINDOW_MS/);
  });

  it("still offers Undo after a long wait", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "dismiss");
    t.mock.timers.tick(60 * 60 * 1000);
    assert.equal(offered(flow, "a1"), true);
    await flow.undo();
    assert.deepEqual(h.sent.at(-1), ["a1", "reopen"]);
  });

  it("a successful Undo sends reopen, puts the pills back with no reload, and says so", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "dismiss");
    await flow.undo();
    assert.deepEqual(h.sent, [
      ["a1", "dismiss"],
      ["a1", "reopen"],
    ]);
    assert.equal(h.refreshes(), 0);
    assert.equal(flow.current().state.kind, "idle");
    assert.deepEqual(alertLineState(flow.current(), "a1"), { kind: "actions" });
    assert.deepEqual(flow.current().message && { tone: flow.current().message?.tone, text: flow.current().message?.text }, {
      tone: "status",
      text: "The alert is back in your queue.",
    });
  });

  it("a failed Undo keeps Undo offered, and a second Undo that works reopens the alert", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "dismiss");
    h.failOnce("reopen");
    await flow.undo();
    assert.equal(flow.current().state.kind, "undoable");
    assert.equal(offered(flow, "a1"), true);
    assert.equal(flow.current().message?.tone, "alert");
    assert.equal(flow.current().message?.text, "Could not undo. Tap Undo to try again.");
    await flow.undo();
    assert.deepEqual(h.sent.slice(-2), [
      ["a1", "reopen"],
      ["a1", "reopen"],
    ]);
    assert.deepEqual(alertLineState(flow.current(), "a1"), { kind: "actions" });
  });

  it("a second Resolved ends the first offer but keeps its line marked done", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.act(LOW2, "resolve");
    assert.equal(offered(flow, "a1"), false);
    assert.deepEqual(alertLineState(flow.current(), "a1"), {
      kind: "done",
      action: "resolve",
      undoable: false,
      undoing: false,
    });
    assert.equal(offered(flow, "a2"), true);
    assert.equal(h.refreshes(), 0);
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
  });

  it("a failed second action gives the earlier offer back", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    h.failOnce("dismiss");
    await flow.act(LOW2, "dismiss");
    assert.equal(offered(flow, "a1"), true);
    assert.deepEqual(alertLineState(flow.current(), "a2"), { kind: "actions" });
  });

  it("ignores a second tap while the first request is still out", async () => {
    const h = harness();
    let release: () => void = () => {};
    const flow = createQueueUndo({
      ...h.deps,
      send: (alertId, action) => {
        h.sent.push([alertId, action]);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    const first = flow.act(LOW, "resolve");
    await flow.act(LOW, "resolve");
    release();
    await first;
    assert.equal(h.sent.length, 1);
  });

  it("marks the line busy while its request is out", async () => {
    const h = harness();
    let release: () => void = () => {};
    const flow = createQueueUndo({
      ...h.deps,
      send: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const pending = flow.act(LOW, "resolve");
    assert.deepEqual(alertLineState(flow.current(), "a1"), { kind: "busy" });
    release();
    await pending;
  });
});

describe("createQueueUndo: reloads", () => {
  it("a reload clears done lines and the offer", async () => {
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

  it("a failed reload clears neither the done lines nor the offer", async () => {
    const h = harness({ refreshResult: false });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.act(LOW2, "snooze");
    assert.deepEqual(flow.current().done, { a1: "resolve" });
    assert.equal(offered(flow, "a1"), true);
  });

  it("a rejected reload is caught and clears nothing", async () => {
    const h = harness({ refreshResult: "reject" });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    await flow.act(LOW2, "snooze");
    assert.deepEqual(flow.current().done, { a1: "resolve" });
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
    assert.equal(h.refreshes(), 0);
  });
});

describe("createQueueUndo: critical alerts", () => {
  it("asks before Resolved, naming the alert and the student", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(CRITICAL, "resolve");
    assert.deepEqual(h.confirms.map((c) => c.title), ['Mark "Wellbeing check" resolved for Jo Park?']);
    assert.equal(offered(flow, "w1"), true);
  });

  it("asks before Dismiss, and says the alert stays hidden", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(CRITICAL, "dismiss");
    assert.equal(h.confirms[0].title, 'Dismiss "Wellbeing check" for Jo Park?');
    assert.match(h.confirms[0].message, /It stays hidden even if the problem continues\. You can undo it right after\./);
  });

  it("asks before Snooze too", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(CRITICAL, "snooze");
    assert.equal(h.confirms[0].title, 'Snooze "Wellbeing check" for Jo Park?');
    assert.equal(h.confirms[0].message, `It leaves your queue for ${SNOOZE_HOURS} hours.`);
    assert.deepEqual(h.sent, [["w1", "snooze"]]);
  });

  it("does nothing when the answer is no", async () => {
    const h = harness({ confirmAnswer: false });
    const flow = createQueueUndo(h.deps);
    await flow.act(CRITICAL, "resolve");
    assert.deepEqual(h.sent, []);
    assert.equal(flow.current().state.kind, "idle");
    assert.deepEqual(alertLineState(flow.current(), "w1"), { kind: "actions" });
  });

  it("declining the confirm leaves an earlier Undo offer as it was", async () => {
    let answer = true;
    const h = harness();
    const flow = createQueueUndo({ ...h.deps, confirm: async () => answer });
    await flow.act(LOW, "dismiss");
    answer = false;
    for (const action of ["resolve", "dismiss", "snooze"] as const) {
      await flow.act(CRITICAL, action);
      assert.equal(offered(flow, "a1"), true, action);
    }
    assert.deepEqual(h.sent, [["a1", "dismiss"]]);
  });

  it("does not ask for an alert that is not critical", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "dismiss");
    await flow.act(LOW2, "snooze");
    assert.deepEqual(h.confirms, []);
  });

  it("keeps the confirm not destructive and free of a time limit", () => {
    for (const action of ["resolve", "dismiss", "snooze"] as const) {
      const question = confirmQuestionFor(CRITICAL, action);
      assert.equal(question.destructive, false);
      assert.doesNotMatch(question.message, /few seconds/);
    }
  });
});

describe("createQueueUndo: focus", () => {
  it("moves focus to Undo after a Resolve, and to the first pill after Undo", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "dismiss");
    assert.equal(flow.current().focus?.elementId, alertControlId("a1", "undo"));
    await flow.undo();
    assert.equal(flow.current().focus?.elementId, alertControlId("a1", "resolve"));
  });

  it("returns focus to the pressed pill when an action fails", async () => {
    const h = harness({ failOn: "dismiss" });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "dismiss");
    assert.equal(flow.current().focus?.elementId, alertControlId("a1", "dismiss"));
  });

  it("keeps focus on Undo when Undo fails", async () => {
    const h = harness({ failOn: "reopen" });
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "resolve");
    const before = flow.current().focus?.id;
    await flow.undo();
    assert.equal(flow.current().focus?.elementId, alertControlId("a1", "undo"));
    assert.notEqual(flow.current().focus?.id, before, "a new request, so the hook moves focus again");
  });

  it("sends focus to the status line after a snooze, since the line leaves", async () => {
    const h = harness();
    const flow = createQueueUndo(h.deps);
    await flow.act(LOW, "snooze");
    assert.equal(flow.current().focus?.elementId, QUEUE_STATUS_ID);
  });
});

describe("createQueueUndo: unmount", () => {
  it("a send in flight at unmount starts nothing and does not reload afterwards", async () => {
    const h = harness();
    let release: () => void = () => {};
    let notified = 0;
    const flow = createQueueUndo({
      ...h.deps,
      send: (alertId, action) => {
        h.sent.push([alertId, action]);
        return new Promise<void>((resolve) => {
          release = resolve;
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
});

describe("queue undo copy", () => {
  it("says what each done line means", () => {
    assert.equal(doneLabel("resolve"), "Marked resolved. It comes back if the problem is still there.");
    assert.equal(doneLabel("dismiss"), "Dismissed. It will not come back.");
  });

  it("no longer sends anyone to the student's page", () => {
    const source = readFileSync(new URL("./queue-undo.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /student's page/);
  });

  it("uses no dash characters in any visible string", async () => {
    const texts: string[] = [doneLabel("resolve"), doneLabel("dismiss")];
    for (const action of ["resolve", "dismiss", "snooze"] as const) {
      const q = confirmQuestionFor(CRITICAL, action);
      texts.push(q.title, q.message, q.confirmLabel, q.cancelLabel);
    }
    for (const failOn of ["resolve", "dismiss", "snooze", "reopen"] as const) {
      const h = harness({ failOn });
      const flow = createQueueUndo(h.deps);
      if (failOn === "reopen") {
        await flow.act(LOW, "resolve");
        await flow.undo();
      } else {
        await flow.act(LOW, failOn);
      }
      texts.push(flow.current().message?.text ?? "");
    }
    const ok = harness();
    const flow = createQueueUndo(ok.deps);
    await flow.act(LOW, "snooze");
    texts.push(flow.current().message?.text ?? "");
    await flow.act(LOW, "resolve");
    await flow.undo();
    texts.push(flow.current().message?.text ?? "");
    for (const text of texts) {
      assert.ok(text.length > 0);
      assert.doesNotMatch(text, /[-‐-―−]/, text);
    }
  });
});
