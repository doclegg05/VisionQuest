import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createUndoQueue, type UndoTimers } from "./undo-queue";

/**
 * HIG: for common destructive actions, offer undo instead of an alert.
 * Dismissing a goal and removing a vision-board pin happened at once with no
 * way back (HIG review B-32, C-47). The queue holds the real request for a few
 * seconds so "Undo" can cancel it.
 */

function fakeTimers() {
  let next = 1;
  const pending = new Map<number, () => void>();
  const timers: UndoTimers = {
    set: (fn) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clear: (id) => {
      pending.delete(id as number);
    },
  };
  const fire = () => {
    const due = [...pending.values()];
    pending.clear();
    due.forEach((fn) => fn());
  };
  return { timers, fire, pendingCount: () => pending.size };
}

function action(label: string) {
  const log: string[] = [];
  let failWith: Error | null = null;
  return {
    log,
    failNextCommit: (error: Error) => {
      failWith = error;
    },
    item: {
      label,
      commit: async () => {
        log.push("commit");
        if (failWith) throw failWith;
      },
      restore: () => log.push("restore"),
      onCommitError: (error: unknown) => log.push(`error:${(error as Error).message}`),
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("createUndoQueue", () => {
  it("commits only after the undo window closes", async () => {
    const { timers, fire } = fakeTimers();
    const queue = createUndoQueue(timers);
    const pin = action("Pin removed.");

    queue.push(pin.item);
    assert.deepEqual(pin.log, []);
    assert.equal(queue.current(), "Pin removed.");

    fire();
    await settle();
    assert.deepEqual(pin.log, ["commit"]);
    assert.equal(queue.current(), null);
  });

  it("restores and never commits when undone", async () => {
    const { timers, fire, pendingCount } = fakeTimers();
    const queue = createUndoQueue(timers);
    const goal = action("Goal removed.");

    queue.push(goal.item);
    queue.undo();
    fire();
    await settle();

    assert.deepEqual(goal.log, ["restore"]);
    assert.equal(pendingCount(), 0);
    assert.equal(queue.current(), null);
  });

  it("commits the previous action at once when a new one arrives", async () => {
    const { timers } = fakeTimers();
    const queue = createUndoQueue(timers);
    const first = action("First removed.");
    const second = action("Second removed.");

    queue.push(first.item);
    queue.push(second.item);
    await settle();

    assert.deepEqual(first.log, ["commit"]);
    assert.deepEqual(second.log, []);
    assert.equal(queue.current(), "Second removed.");
  });

  it("commits what is pending when flushed, as on leaving the page", async () => {
    const { timers, pendingCount } = fakeTimers();
    const queue = createUndoQueue(timers);
    const pin = action("Pin removed.");

    queue.push(pin.item);
    queue.flush();
    await settle();

    assert.deepEqual(pin.log, ["commit"]);
    assert.equal(pendingCount(), 0);
  });

  it("restores the item and reports when the commit fails", async () => {
    const { timers, fire } = fakeTimers();
    const queue = createUndoQueue(timers);
    const pin = action("Pin removed.");
    pin.failNextCommit(new Error("offline"));

    queue.push(pin.item);
    fire();
    await settle();

    assert.deepEqual(pin.log, ["commit", "restore", "error:offline"]);
  });

  it("tells subscribers when the visible label changes", () => {
    const { timers } = fakeTimers();
    const queue = createUndoQueue(timers);
    const seen: Array<string | null> = [];
    const unsubscribe = queue.subscribe(() => seen.push(queue.current()));

    queue.push(action("Pin removed.").item);
    queue.undo();
    unsubscribe();
    queue.push(action("Ignored.").item);

    assert.deepEqual(seen, ["Pin removed.", null]);
  });
});
