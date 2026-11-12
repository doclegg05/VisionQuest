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
  type UndoExpectation,
} from "./queue-undo";
import {
  CRITICAL,
  harness,
  holding,
  landReload,
  LOW,
  LOW2,
  offered,
  withOpenConfirm,
  receiptFor,
} from "./queue-undo.test-support";

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
    assert.equal(flow.current().message?.text, "Could not undo. Try Undo again.");
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
        return new Promise<UndoExpectation | null>((resolve) => {
          release = () => resolve(receiptFor(action));
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
      send: (_alertId, action) =>
        new Promise<UndoExpectation | null>((resolve) => {
          release = () => resolve(receiptFor(action));
        }),
    });
    const pending = flow.act(LOW, "resolve");
    assert.deepEqual(alertLineState(flow.current(), "a1"), { kind: "busy" });
    release();
    await pending;
  });
});

describe("createQueueUndo: lines while a request is out", () => {
  it("marks every line that is not done busy while a Dismiss is sending", async () => {
    const h = harness();
    const held = holding(h, "dismiss");
    const flow = createQueueUndo(held.deps);
    await flow.act(LOW, "resolve");
    const pending = flow.act(LOW2, "dismiss");
    assert.deepEqual(alertLineState(flow.current(), "a2"), { kind: "busy" });
    assert.deepEqual(alertLineState(flow.current(), "another-alert"), { kind: "busy" });
    assert.equal(alertLineState(flow.current(), "a1").kind, "done", "a done line stays a done line");
    held.release();
    await pending;
    assert.deepEqual(alertLineState(flow.current(), "another-alert"), { kind: "actions" });
  });

  it("marks the other lines busy while a confirm is open", async () => {
    const { flow, answer } = withOpenConfirm(harness());
    const pending = flow.act(CRITICAL, "resolve");
    assert.deepEqual(alertLineState(flow.current(), "w1"), { kind: "busy" });
    assert.deepEqual(alertLineState(flow.current(), "another-alert"), { kind: "busy" });
    answer(false);
    await pending;
    assert.deepEqual(alertLineState(flow.current(), "another-alert"), { kind: "actions" });
  });

  it("marks the other lines busy while an Undo is out", async () => {
    const h = harness();
    const held = holding(h, "reopen");
    const flow = createQueueUndo(held.deps);
    await flow.act(LOW, "resolve");
    const pending = flow.undo();
    assert.deepEqual(alertLineState(flow.current(), "another-alert"), { kind: "busy" });
    held.release();
    await pending;
    assert.deepEqual(alertLineState(flow.current(), "another-alert"), { kind: "actions" });
  });

  it("says whether a tap would be taken, so an ignored tap clears nothing", async () => {
    const h = harness();
    const held = holding(h, "dismiss");
    const flow = createQueueUndo(held.deps);
    assert.equal(flow.canAct(), true, "idle");
    await flow.act(LOW, "resolve");
    assert.equal(flow.canAct(), true, "an Undo offer does not block the next action");
    const pending = flow.act(LOW2, "dismiss");
    assert.equal(flow.canAct(), false, "a request is out");
    const before = flow.current();
    await flow.act(CRITICAL, "resolve");
    assert.equal(flow.current(), before, "the ignored tap changed nothing");
    assert.deepEqual(h.confirms, [], "and asked nothing");
    held.release();
    await pending;
    assert.equal(flow.canAct(), true);
    flow.dispose();
    assert.equal(flow.canAct(), false, "unmounted");
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
    assert.equal(
      h.confirms[0].message,
      "It leaves your queue. It stays hidden even if the problem continues. You can undo it until you resolve or dismiss another alert.",
    );
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

describe("queue undo copy", () => {
  it("says what each done line means", () => {
    assert.equal(doneLabel("resolve"), "Marked resolved. It comes back if the problem is still there.");
    assert.equal(doneLabel("dismiss"), "Dismissed. It will not come back.");
    assert.equal(doneLabel("snooze"), `Snoozed for ${SNOOZE_HOURS} hours.`);
  });

  it("promises Undo only until the next Resolved or Dismiss", () => {
    for (const action of ["resolve", "dismiss"] as const) {
      const { message } = confirmQuestionFor(CRITICAL, action);
      assert.match(message, /You can undo it until you resolve or dismiss another alert\.$/, action);
      assert.doesNotMatch(message, /right after/, action);
    }
    assert.doesNotMatch(confirmQuestionFor(CRITICAL, "snooze").message, /undo/i, "a snooze offers no Undo");
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
    for (const action of ["resolve", "dismiss"] as const) {
      const h = harness({ failOn: "reopen" });
      const flow = createQueueUndo(h.deps);
      await flow.act(LOW, action);
      const pending = flow.undo();
      landReload(flow);
      await pending;
      texts.push(flow.current().message?.text ?? "");
    }
    texts.push(doneLabel("snooze"));
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
