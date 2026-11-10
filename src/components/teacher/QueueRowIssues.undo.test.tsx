import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import type { QueueAlert } from "@/lib/teacher/intervention-queue";
import { groupQueueIssues } from "@/lib/teacher/queue-issue-groups";
import { QueueRowIssues } from "./QueueRowIssues";
import { QueueUndoLineContext } from "./queue-undo-context";
import { QueueUndoActionContext } from "./queue-undo-action-context";
import type { AlertLineState } from "./queue-undo";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const noop = () => {};

const ALERT: QueueAlert = {
  id: "g1",
  type: "goal_review_pending",
  severity: "medium",
  title: "Goal review",
  summary: "New evidence on a goal.",
  sourceType: null,
  sourceId: null,
  detectedAt: "2026-10-03T12:00:00.000Z",
};

function render(lineState?: AlertLineState): string {
  const issues = (
    <QueueRowIssues
      id="queue-issues-stu-1"
      studentName="Sam Rivera"
      groups={groupQueueIssues([ALERT], "stu-1")}
      now={NOW}
      onQuickAction={noop}
      onAlertAction={noop}
    />
  );
  if (!lineState) return renderToString(issues);
  return renderToString(
    <QueueUndoActionContext.Provider value={noop}>
      <QueueUndoLineContext.Provider value={() => lineState}>{issues}</QueueUndoLineContext.Provider>
    </QueueUndoActionContext.Provider>,
  );
}

function buttonTag(html: string, label: string): string {
  const match = html.match(new RegExp(`<button[^>]*>${label}</button>`));
  assert.ok(match, `no ${label} button`);
  return match[0];
}

describe("QueueRowIssues alert actions", () => {
  const html = render();

  it("puts Resolved first and Dismiss last, with Snooze between them", () => {
    const order = ["Resolved", "Snooze", "Dismiss"].map((label) => html.indexOf(`>${label}</button>`));
    assert.ok(order.every((index) => index > 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  it("pushes Dismiss to the far end of the row, away from Resolved", () => {
    assert.match(buttonTag(html, "Dismiss"), /\bml-auto\b/);
  });

  it("makes Dismiss quieter than Resolved: no outline and muted text", () => {
    const dismiss = buttonTag(html, "Dismiss");
    const resolved = buttonTag(html, "Resolved");
    assert.doesNotMatch(dismiss, /\bborder\b/);
    assert.match(dismiss, /text-\[var\(--ink-muted\)\]/);
    assert.match(resolved, /\bborder\b/);
    assert.match(resolved, /text-\[var\(--ink-strong\)\]/);
  });

  it("keeps every action at least 44px tall", () => {
    for (const label of ["Resolved", "Snooze", "Dismiss"]) {
      assert.match(buttonTag(html, label), /\bmin-h-11\b/, label);
    }
  });

  it("gives every pill an id so focus can come back after Undo or a failure", () => {
    assert.match(buttonTag(html, "Resolved"), /id="queue-alert-g1-resolve"/);
    assert.match(buttonTag(html, "Snooze"), /id="queue-alert-g1-snooze"/);
    assert.match(buttonTag(html, "Dismiss"), /id="queue-alert-g1-dismiss"/);
  });

  it("uses no raw palette colors", () => {
    assert.doesNotMatch(html, /\b(?:bg|text|border)-(?:red|green|blue|gray|slate|amber|emerald|rose)-\d/);
  });

  it("keeps a done alert in place: the text, then Undo, and no pills", () => {
    const done = render({ kind: "done", action: "resolve", undoable: true, undoing: false });
    const text = "Marked resolved. It comes back if the problem is still there.";
    assert.ok(done.includes(text));
    assert.doesNotMatch(done, />Resolved<\/button>/);
    assert.doesNotMatch(done, />Snooze<\/button>/);
    assert.doesNotMatch(done, />Dismiss<\/button>/);
    assert.match(done, /New evidence on a goal\./, "the line keeps its text so the row keeps its height");
    const undo = buttonTag(done, "Undo");
    assert.ok(done.indexOf(text) < done.indexOf(undo), "Undo comes right after the text");
    assert.match(undo, /\bmin-h-11\b/);
    assert.match(undo, /id="queue-alert-g1-undo"/);
    assert.match(undo, /aria-label="Undo &quot;Goal review&quot; for Sam Rivera"/);
  });

  it("does not put Undo inside a right-pushed group where Dismiss was", () => {
    const done = render({ kind: "done", action: "dismiss", undoable: true, undoing: false });
    assert.doesNotMatch(done, /\bml-auto\b/);
    assert.doesNotMatch(buttonTag(done, "Undo"), /\bml-auto\b/);
  });

  it("gives the done text a line of its own, so Undo starts the next line at the left edge", () => {
    // "Dismissed. It will not come back." is short. Without this, Undo sits beside it, about where Dismiss was.
    for (const action of ["resolve", "dismiss"] as const) {
      const done = render({ kind: "done", action, undoable: true, undoing: false });
      const text = done.match(/<p[^>]*id="queue-alert-g1-undo-text"[^>]*>/)?.[0];
      assert.ok(text, "no done text");
      assert.match(text, /\bbasis-full\b/, action);
      assert.doesNotMatch(buttonTag(done, "Undo"), /\bbasis-full\b/, action);
    }
  });

  it("shows a snoozed alert as a done line: the text, no Undo and no pills", () => {
    const snoozed = render({ kind: "done", action: "snooze", undoable: false, undoing: false });
    assert.match(snoozed, /Snoozed for 24 hours\./);
    for (const label of ["Resolved", "Snooze", "Dismiss", "Undo"]) {
      assert.doesNotMatch(snoozed, new RegExp(`>${label}</button>`), label);
    }
    assert.match(snoozed, /New evidence on a goal\./, "the line keeps its summary");
  });

  it("says what a dismiss means", () => {
    assert.match(render({ kind: "done", action: "dismiss", undoable: false, undoing: false }), /Dismissed\. It will not come back\./);
  });

  it("shows an earlier done line as plain text with no Undo", () => {
    const earlier = render({ kind: "done", action: "resolve", undoable: false, undoing: false });
    assert.match(earlier, /Marked resolved\./);
    assert.doesNotMatch(earlier, />Undo<\/button>/);
  });

  it("keeps Undo focusable while it is sending, so focus never falls to the page", () => {
    const undo = buttonTag(render({ kind: "done", action: "resolve", undoable: true, undoing: true }), "Undo");
    assert.match(undo, /aria-disabled="true"/);
    assert.doesNotMatch(undo, /\sdisabled=""/);
  });

  it("keeps the pills focusable while the request is out, and marks them unavailable", () => {
    const busy = render({ kind: "busy" });
    for (const label of ["Resolved", "Snooze", "Dismiss"]) {
      assert.match(buttonTag(busy, label), /aria-disabled="true"/, label);
      assert.doesNotMatch(buttonTag(busy, label), /\sdisabled=""/, label);
    }
  });

  it("uses no dash characters in visible text", () => {
    for (const state of [undefined, { kind: "done", action: "resolve", undoable: true, undoing: false } as const]) {
      const visible = render(state).replace(/<[^>]*>/g, " ");
      assert.doesNotMatch(visible, /[\u2010-\u2015\u2212]| - /);
    }
  });
});
