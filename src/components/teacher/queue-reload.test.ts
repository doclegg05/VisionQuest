import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runQueueLoad, type QueueLoadSteps } from "./queue-reload";
import { alertLineState, createQueueUndo, type QueueUndo, type QueueUndoTarget } from "./queue-undo";

const ROWS = ["row"];

interface Probe {
  steps: QueueLoadSteps<string[]>;
  /** Every call the load made, in order. */
  calls: string[];
  answer: (rows: string[]) => void;
  failLoad: () => void;
  /** A newer load, or a class change, replaced this one. */
  replace: () => void;
}

function probe(token = 7): Probe {
  const calls: string[] = [];
  let latest = true;
  let answer: (rows: string[]) => void = () => {};
  let failLoad: () => void = () => {};
  const steps: QueueLoadSteps<string[]> = {
    reload: {
      beginReload: () => {
        calls.push("beginReload");
        return token;
      },
      reloaded: (landed) => {
        calls.push(`reloaded(${String(landed)})`);
      },
    },
    isLatest: () => latest,
    fetchRows: () => {
      calls.push("fetchRows");
      return new Promise<string[]>((resolve, reject) => {
        answer = resolve;
        failLoad = () => reject(new Error("offline"));
      });
    },
    show: (rows) => {
      calls.push(`show(${rows.join(",")})`);
    },
    fail: () => {
      calls.push("fail");
    },
  };
  return {
    steps,
    calls,
    answer: (rows) => answer(rows),
    failLoad: () => failLoad(),
    replace: () => {
      latest = false;
    },
  };
}

describe("runQueueLoad", () => {
  it("takes its token before the request leaves", () => {
    const p = probe();
    void runQueueLoad(p.steps);
    assert.deepEqual(p.calls, ["beginReload", "fetchRows"]);
  });

  it("shows the rows of the newest load, then tells the flow with the token it took at the start", async () => {
    const p = probe(7);
    const pending = runQueueLoad(p.steps);
    p.answer(ROWS);
    assert.deepEqual(await pending, ROWS);
    assert.deepEqual(p.calls, ["beginReload", "fetchRows", "show(row)", "reloaded(7)"]);
  });

  it("a load that a newer one replaced shows nothing and tells the flow nothing", async () => {
    const p = probe();
    const pending = runQueueLoad(p.steps);
    p.replace();
    p.answer(ROWS);
    assert.deepEqual(await pending, ROWS, "the caller still gets what it loaded");
    assert.deepEqual(p.calls, ["beginReload", "fetchRows"]);
  });

  it("a failed load shows the failure and tells the flow nothing", async () => {
    const p = probe();
    const pending = runQueueLoad(p.steps);
    p.failLoad();
    assert.equal(await pending, null);
    assert.deepEqual(p.calls, ["beginReload", "fetchRows", "fail"]);
  });

  it("a failed load that a newer one replaced shows nothing at all", async () => {
    const p = probe();
    const pending = runQueueLoad(p.steps);
    p.replace();
    p.failLoad();
    assert.equal(await pending, null);
    assert.deepEqual(p.calls, ["beginReload", "fetchRows"]);
  });
});

const A: QueueUndoTarget = { id: "a", severity: "medium", title: "Goal review", studentName: "Sam Rivera" };
const B: QueueUndoTarget = { id: "b", severity: "low", title: "Missing form", studentName: "Ana Lopez" };

/** The Undo flow wired to runQueueLoad the way the panel wires it, with each request held until the test answers. */
function panelLike(): { flow: QueueUndo; answers: Array<() => void>; shown: () => number } {
  const answers: Array<() => void> = [];
  let requests = 0;
  let shown = 0;
  const flow = createQueueUndo({
    send: async () => {},
    confirm: async () => true,
    refresh: (reload) => {
      requests += 1;
      const request = requests;
      return runQueueLoad({
        reload,
        isLatest: () => request === requests,
        fetchRows: () => new Promise<string[]>((resolve) => answers.push(() => resolve(ROWS))),
        show: () => {
          shown += 1;
        },
        fail: () => {},
      });
    },
  });
  return { flow, answers, shown: () => shown };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("runQueueLoad with the Undo flow", () => {
  it("a snooze's reload that lands after a later Dismiss leaves that Dismiss undoable", async () => {
    const { flow, answers } = panelLike();
    const snooze = flow.act(A, "snooze");
    await settle();
    assert.equal(answers.length, 1, "the snooze started a reload");
    await flow.act(B, "dismiss");
    answers[0]();
    await snooze;
    assert.deepEqual(alertLineState(flow.current(), "a"), { kind: "actions" }, "the snoozed line cleared");
    assert.deepEqual(alertLineState(flow.current(), "b"), {
      kind: "done",
      action: "dismiss",
      undoable: true,
      undoing: false,
    });
  });

  it("the next load, begun after that Dismiss, clears it", async () => {
    const { flow, answers } = panelLike();
    const snooze = flow.act(A, "snooze");
    await settle();
    await flow.act(B, "dismiss");
    answers[0]();
    await snooze;
    const second = flow.act(A, "snooze");
    await settle();
    answers[1]();
    await second;
    assert.deepEqual(flow.current().done, {});
    assert.equal(flow.current().state.kind, "idle");
  });

  it("a snooze's reload that a newer load replaced clears nothing when it lands", async () => {
    const { flow, answers, shown } = panelLike();
    const first = flow.act(A, "snooze");
    await settle();
    const second = flow.act(B, "snooze");
    await settle();
    answers[0]();
    await first;
    assert.equal(shown(), 0);
    assert.equal(alertLineState(flow.current(), "a").kind, "done", "the replaced load cleared nothing");
    answers[1]();
    await second;
    assert.deepEqual(flow.current().done, {});
  });
});
