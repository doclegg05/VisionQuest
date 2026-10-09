import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createUndoQueue } from "./undo-queue";

/**
 * HIG: for common destructive actions, offer undo instead of an alert.
 * Dismissing a goal and removing a vision-board pin happened at once with no
 * way back (HIG review B-32, C-47).
 *
 * There is no timer. A 6-second window was a time limit that people using a
 * screen reader or switch control could not meet (WCAG 2.2.1; HIG
 * accessibility: "Prefer dismissing views with an explicit action"). The
 * request is sent when the person dismisses the notice, makes another
 * removal, or leaves the page.
 */

function action(label: string, opts: { failWith?: Error; throwSync?: boolean } = {}) {
  const log: string[] = [];
  return {
    log,
    item: {
      label,
      restoredLabel: `${label.replace(/ removed\.$/, "")} restored.`,
      commit: (): Promise<void> => {
        log.push("commit");
        if (opts.throwSync) throw opts.failWith ?? new Error("sync");
        return opts.failWith ? Promise.reject(opts.failWith) : Promise.resolve();
      },
      restore: () => log.push("restore"),
      onCommitError: (error: unknown) => log.push(`error:${(error as Error).message}`),
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("createUndoQueue", () => {
  it("holds a removal until the person dismisses it, however long they take", async () => {
    const queue = createUndoQueue();
    const pin = action("Pin removed.");

    queue.push(pin.item);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(pin.log, []);
    assert.equal(queue.current()?.label, "Pin removed.");
    assert.equal(queue.current()?.kind, "pending");

    queue.flush();
    await settle();
    assert.deepEqual(pin.log, ["commit"]);
    assert.equal(queue.current(), null);
  });

  it("restores, never commits, and announces the restore when undone", async () => {
    const queue = createUndoQueue();
    const goal = action("Goal removed.");

    queue.push(goal.item);
    const undone = queue.undo();
    queue.flush();
    await settle();

    assert.equal(undone, goal.item);
    assert.deepEqual(goal.log, ["restore"]);
    assert.deepEqual({ kind: queue.current()?.kind, label: queue.current()?.label }, { kind: "restored", label: "Goal restored." });
  });

  it("commits the previous removal at once when a new one arrives", async () => {
    const queue = createUndoQueue();
    const first = action("First removed.");
    const second = action("Second removed.");

    queue.push(first.item);
    queue.push(second.item);
    await settle();

    assert.deepEqual(first.log, ["commit"]);
    assert.deepEqual(second.log, []);
    assert.equal(queue.current()?.label, "Second removed.");
  });

  it("gives every notice a new id, so a repeated label is announced again", () => {
    const queue = createUndoQueue();
    queue.push(action("Pin removed.").item);
    const first = queue.current()?.id;
    queue.push(action("Pin removed.").item);
    assert.notEqual(queue.current()?.id, first);
  });

  it("returns the same snapshot object until something changes", () => {
    const queue = createUndoQueue();
    queue.push(action("Pin removed.").item);
    assert.equal(queue.current(), queue.current());
  });

  it("restores the item and reports when the commit fails", async () => {
    const queue = createUndoQueue();
    const pin = action("Pin removed.", { failWith: new Error("offline") });

    queue.push(pin.item);
    queue.flush();
    await settle();

    assert.deepEqual(pin.log, ["commit", "restore", "error:offline"]);
  });

  it("treats a commit that throws synchronously the same way", async () => {
    const queue = createUndoQueue();
    const pin = action("Pin removed.", { failWith: new Error("bad id"), throwSync: true });

    queue.push(pin.item);
    assert.doesNotThrow(() => queue.flush());
    await settle();

    assert.deepEqual(pin.log, ["commit", "restore", "error:bad id"]);
  });

  it("clears a restored notice on request", () => {
    const queue = createUndoQueue();
    queue.push(action("Pin removed.").item);
    queue.undo();
    queue.clear();
    assert.equal(queue.current(), null);
  });

  it("tells subscribers about every change", () => {
    const queue = createUndoQueue();
    const seen: Array<string | null> = [];
    const unsubscribe = queue.subscribe(() => seen.push(queue.current()?.kind ?? null));

    queue.push(action("Pin removed.").item);
    queue.undo();
    queue.clear();
    unsubscribe();
    queue.push(action("Ignored.").item);

    assert.deepEqual(seen, ["pending", "restored", null]);
  });
});
