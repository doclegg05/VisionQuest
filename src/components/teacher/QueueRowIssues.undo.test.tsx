import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import type { QueueAlert } from "@/lib/teacher/intervention-queue";
import { groupQueueIssues } from "@/lib/teacher/queue-issue-groups";
import { QueueRowIssues } from "./QueueRowIssues";
import { QueueUndoLineContext } from "./queue-undo-context";
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
    <QueueUndoLineContext.Provider value={() => lineState}>{issues}</QueueUndoLineContext.Provider>,
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

  it("gives Resolved and Dismiss ids so focus can come back after Undo", () => {
    assert.match(buttonTag(html, "Resolved"), /id="queue-alert-g1-resolve"/);
    assert.match(buttonTag(html, "Dismiss"), /id="queue-alert-g1-dismiss"/);
  });

  it("uses no raw palette colors", () => {
    assert.doesNotMatch(html, /\b(?:bg|text|border)-(?:red|green|blue|gray|slate|amber|emerald|rose)-\d/);
  });

  it("keeps a done alert in place, marked done, with no action buttons", () => {
    const done = render({ kind: "done", action: "resolve" });
    assert.match(done, /Marked resolved\./);
    assert.doesNotMatch(done, />Resolved<\/button>/);
    assert.doesNotMatch(done, />Dismiss<\/button>/);
    assert.match(done, /New evidence on a goal\./, "the line keeps its text so the row keeps its height");
    assert.match(done, /min-h-11/);
  });

  it("says Dismissed. for a dismissed alert", () => {
    assert.match(render({ kind: "done", action: "dismiss" }), /Dismissed\./);
  });

  it("disables the actions while the request is out", () => {
    const busy = render({ kind: "busy" });
    for (const label of ["Resolved", "Snooze", "Dismiss"]) {
      assert.match(buttonTag(busy, label), /disabled=""/, label);
    }
  });
});
