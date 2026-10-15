import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { formatWellbeingCardSummary } from "@/lib/sage/wellbeing-card";
import type { QueueAlert } from "@/lib/teacher/intervention-queue";
import { groupQueueIssues } from "@/lib/teacher/queue-issue-groups";
import { QueueRowIssues } from "./QueueRowIssues";
import { WellbeingCrisisCard } from "./WellbeingCrisisCard";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const noop = () => {};

function alert(id: string, type: string, severity: string, summary: string): QueueAlert {
  return {
    id,
    type,
    severity,
    title: `Title ${id}`,
    summary,
    sourceType: null,
    sourceId: null,
    detectedAt: "2026-10-03T12:00:00.000Z",
  };
}

const CRISIS_SUMMARY = formatWellbeingCardSummary({
  category: "low_mood",
  detectedAt: new Date("2026-10-03T12:00:00.000Z"),
  mood: null,
});
const alerts = [
  alert("w1", "wellbeing_concern", "critical", CRISIS_SUMMARY),
  alert("f1", "orientation_form_missing", "medium", "Intake form not turned in."),
  alert("f2", "orientation_form_missing", "medium", "Release form not turned in."),
  alert("g1", "goal_review_pending", "medium", "New evidence on a goal."),
];
const html = renderToString(
  <QueueRowIssues
    id="queue-issues-stu-1"
    studentName="Sam Rivera"
    groups={groupQueueIssues(alerts, "stu-1")}
    now={NOW}
    onQuickAction={noop}
    onAlertAction={noop}
  />,
);

describe("QueueRowIssues", () => {
  it("is the element the row toggle controls", () => {
    assert.match(html, /<ul[^>]*id="queue-issues-stu-1"/);
  });

  it("shows the full crisis card, not one line", () => {
    assert.ok(html.includes(renderToString(<WellbeingCrisisCard summary={CRISIS_SUMMARY} />)));
  });

  it("renders the crisis card's structured checklist", () => {
    assert.match(html, /<ol[^>]*>\s*<li>Reach the student today/);
  });

  it("keeps the urgent group on the card surface", () => {
    // The critical tint drops the crisis card's faint "detected" text below 4.5:1 in dark.
    // The card's own category chip may use the tint (it is a span), so only group <li> tags are checked.
    assert.doesNotMatch(html, /<li[^>]*--urgency-critical-bg/);
  });

  it("shows every alert, with its age", () => {
    for (const summary of ["Intake form not turned in.", "Release form not turned in.", "New evidence on a goal."]) {
      assert.ok(html.includes(summary), `missing ${summary}`);
    }
    assert.match(html, /Open 3 days/);
  });

  it("keeps Quick review for goal evidence", () => {
    assert.match(html, />Quick review</);
  });

  it("names the student on every alert control", () => {
    for (const verb of ["Snooze", "Dismiss"]) {
      const count = html.split(`aria-label="${verb} &quot;`).length - 1;
      assert.equal(count, alerts.length, `${verb} should appear once per alert`);
    }
    assert.match(html, /for Sam Rivera/);
  });
});
