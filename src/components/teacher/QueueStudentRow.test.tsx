import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { formatWellbeingCardSummary } from "@/lib/sage/wellbeing-card";
import type { InterventionQueueEntry, QueueAlert } from "@/lib/teacher/intervention-queue";
import { QueueStudentRow, type QueueStudentRowProps } from "./QueueStudentRow";
import { WellbeingCrisisCard } from "./WellbeingCrisisCard";

const noop = () => {};
const CRISIS: QueueAlert = {
  id: "w1",
  type: "wellbeing_concern",
  severity: "critical",
  title: "Wellbeing check-in needed",
  summary: formatWellbeingCardSummary({
    category: "low_mood",
    detectedAt: new Date("2026-10-05T12:00:00.000Z"),
    mood: null,
  }),
  sourceType: "conversation",
  sourceId: null,
  detectedAt: "2026-10-05T12:00:00.000Z",
};
const TASK: QueueAlert = { ...CRISIS, id: "t1", type: "overdue_task", severity: "medium", title: "Overdue task", summary: "Résumé draft is overdue." };

function entry(overrides: Partial<InterventionQueueEntry> = {}): InterventionQueueEntry {
  return {
    studentId: "stu-1",
    publicStudentId: "S-001",
    name: "Sam Rivera",
    email: null,
    programType: "spokes",
    urgencyScore: 30,
    urgencyReasons: ["1 open alert", "orientation incomplete"],
    primaryAlert: TASK,
    openAlerts: [TASK],
    recommendedAction: { kind: "create_task", label: "Add task", href: "/teacher/students/stu-1#follow-up-tasks" },
    signals: {
      daysSinceLastGoalReview: null,
      daysSinceLastLogin: 2,
      orientationComplete: false,
      orientationProgress: 0.5,
      openAlertCount: 1,
      highSeverityAlertCount: 0,
      overdueTaskCount: 1,
      stalledGoalCount: 0,
      unmatchedGoalCount: 0,
      evidenceGapCount: 0,
      readinessScore: 50,
    },
    ...overrides,
  };
}

function render(overrides: Partial<QueueStudentRowProps> = {}): string {
  return renderToString(
    <QueueStudentRow
      student={entry()}
      now={Date.parse("2026-10-06T12:00:00.000Z")}
      actionPanel={null}
      onMainAction={noop}
      onQuickAction={noop}
      onAlertAction={noop}
      onQuickTask={noop}
      onQuickNote={noop}
      onSchedule={noop}
      onAskSage={noop}
      {...overrides}
    />,
  );
}

describe("QueueStudentRow", () => {
  it("opens a crisis row with the full crisis card showing", () => {
    const html = render({ student: entry({ primaryAlert: CRISIS, openAlerts: [CRISIS, TASK] }) });
    assert.match(html, /aria-expanded="true"/);
    assert.ok(html.includes(renderToString(<WellbeingCrisisCard summary={CRISIS.summary} />)));
    assert.match(html, /<ol[^>]*>\s*<li>Reach the student today/);
    assert.match(html, />Critical</);
  });

  it("starts other rows collapsed, with the public ID and the alert age", () => {
    const html = render();
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-controls="queue-issues-stu-1"/);
    assert.match(html, /S-001/);
    assert.match(html, /Open 1 day/);
  });

  it("names the student on every tool", () => {
    const html = render();
    for (const label of [
      "Add a note for Sam Rivera",
      "Schedule an appointment with Sam Rivera",
      "Assign a task to Sam Rivera",
      "Ask Sage about Sam Rivera",
    ]) {
      assert.ok(html.includes(`aria-label="${label}"`), `missing ${label}`);
    }
  });

  it("renders the action panel inside the row", () => {
    const html = render({ actionPanel: <div data-testid="row-panel">panel</div> });
    assert.ok(html.startsWith("<li"), "the row root is the list item");
    assert.ok(html.trimEnd().endsWith("</li>"));
    assert.match(html, /data-testid="row-panel"/);
  });

  it("offers no issues toggle when there are no alerts", () => {
    const html = render({ student: entry({ primaryAlert: null, openAlerts: [] }) });
    assert.doesNotMatch(html, /See all/);
  });

  it("renders no empty issues list when a crisis row has no open alerts left", () => {
    // Stands in for a refresh that cleared every alert while the crisis row was open.
    const html = render({ student: entry({ primaryAlert: CRISIS, openAlerts: [] }) });
    assert.doesNotMatch(html, /Open issues for Sam Rivera/);
    assert.doesNotMatch(html, /id="queue-issues-stu-1"/);
  });
});

// Ported from the branch's InterventionQueue.test.tsx (M10) when upstream
// deleted that component (c487091a): the row's disclosure toggle must not
// nest another control, or tapping a quick action also toggles the row and a
// screen reader reads the actions as part of the toggle's label.
describe("QueueStudentRow disclosure toggle (M10)", () => {
  it("nests no interactive element inside the toggle button", () => {
    const html = render();
    const open = /<button\b[^>]*aria-expanded[^>]*>/.exec(html);
    assert.ok(open, "expected a disclosure toggle carrying aria-expanded");
    const rest = html.slice(open.index + open[0].length);
    const inner = rest.slice(0, rest.indexOf("</button>"));
    assert.doesNotMatch(inner, /<button\b|<a\b/);
  });
});
