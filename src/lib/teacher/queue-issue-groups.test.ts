import assert from "node:assert/strict";
import test from "node:test";
import { getInactivityStageByType } from "@/lib/inactivity";
import type { QueueAlert } from "./intervention-queue";
import {
  buildQueueSageMessage,
  buildStudentSageMessage,
  countInactivityStages,
  groupQueueIssues,
  openForLabel,
  visibleQueueRows,
} from "./queue-issue-groups";

const STUDENT = "student-1";

function alert(id: string, type: string, severity = "medium", title = `Title ${id}`): QueueAlert {
  return {
    id,
    type,
    severity,
    title,
    summary: `Summary ${id}`,
    sourceType: null,
    sourceId: null,
    detectedAt: "2026-10-01T00:00:00.000Z",
  };
}

test("same-type alerts fold into one counted group", () => {
  const groups = groupQueueIssues(
    [alert("f1", "orientation_form_missing"), alert("f2", "orientation_form_missing"), alert("f3", "orientation_form_missing")],
    STUDENT,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.label, "3 orientation forms missing");
  assert.equal(groups[0]?.category, "Orientation");
  assert.equal(groups[0]?.count, 3);
});

test("a group of one keeps the alert's own title", () => {
  const [group] = groupQueueIssues([alert("t1", "overdue_task", "medium", "Résumé draft is overdue")], STUDENT);
  assert.equal(group?.label, "Résumé draft is overdue");
});

test("a crisis alert is never folded and always comes first", () => {
  const groups = groupQueueIssues(
    [
      alert("f1", "orientation_form_missing", "high"),
      alert("f2", "orientation_form_missing", "high"),
      alert("w1", "wellbeing_concern", "critical", "Wellbeing check-in needed"),
    ],
    STUDENT,
  );
  assert.equal(groups[0]?.category, "Wellbeing");
  assert.equal(groups[0]?.count, 1);
  assert.equal(groups[0]?.urgent, true);
});

test("goal review items keep the review quick action", () => {
  const [group] = groupQueueIssues([alert("g1", "goal_review_pending")], STUDENT);
  assert.deepEqual(group?.quickAction, { kind: "review_forms", label: "Quick review" });
});

test("an assign-support action needs a goal to attach to", () => {
  const [group] = groupQueueIssues([alert("g2", "goal_needs_resource")], STUDENT);
  assert.equal(group?.quickAction, null, "no goal source, so the panel cannot assign support");
});

test("inactivity alerts carry their stage guidance", () => {
  const stage = getInactivityStageByType("inactive_student_30");
  const [group] = groupQueueIssues([alert("i1", "inactive_student_30", "high")], STUDENT);
  assert.equal(group?.category, "Inactive");
  assert.equal(group?.label, stage?.label);
  assert.equal(group?.nextStep, stage?.nextStep);
});

test("no alert is dropped: 12 alerts over six types add back up to 12", () => {
  const alerts = [
    ...["a", "b", "c"].map((s) => alert(`f-${s}`, "orientation_form_missing")),
    ...["a", "b", "c", "d"].map((s) => alert(`t-${s}`, "overdue_task")),
    ...["a", "b"].map((s) => alert(`e-${s}`, "evidence_gap", "high")),
    alert("g-a", "goal_review_pending"),
    alert("w-a", "wellbeing_concern", "critical"),
    alert("x-a", "some_future_alert_type"),
  ];
  const groups = groupQueueIssues(alerts, STUDENT);
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), 12);
  assert.deepEqual(
    new Set(groups.flatMap((group) => group.alerts.map((a) => a.id))),
    new Set(alerts.map((a) => a.id)),
  );
});

test("openForLabel counts whole days", () => {
  const now = Date.parse("2026-10-06T12:00:00.000Z");
  assert.equal(openForLabel("2026-10-06T08:00:00.000Z", now), "Open since today");
  assert.equal(openForLabel("2026-10-05T08:00:00.000Z", now), "Open 1 day");
  assert.equal(openForLabel("2026-10-01T08:00:00.000Z", now), "Open 5 days");
});

test("inactivity counts follow stage order and skip empty stages", () => {
  const counts = countInactivityStages([
    { openAlerts: [alert("a", "inactive_student_30", "high")] },
    { openAlerts: [alert("b", "inactive_student_14")] },
    { openAlerts: [alert("c", "inactive_student_14"), alert("d", "overdue_task")] },
  ]);
  assert.deepEqual(counts, [
    { label: getInactivityStageByType("inactive_student_14")?.label, count: 2 },
    { label: getInactivityStageByType("inactive_student_30")?.label, count: 1 },
  ]);
});

test("the first view shows 10 rows plus any urgent row below them", () => {
  const rows = Array.from({ length: 14 }, (_, index) => ({
    id: index + 1,
    signals: { highSeverityAlertCount: index === 11 ? 1 : 0 },
  }));
  assert.deepEqual(visibleQueueRows(rows, false).map((row) => row.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
  assert.equal(visibleQueueRows(rows, true).length, 14);
});

test("Sage prompts list every group and mark urgent ones", () => {
  const groups = groupQueueIssues(
    [alert("w1", "wellbeing_concern", "critical", "Wellbeing check-in needed"), alert("t1", "overdue_task")],
    STUDENT,
  );
  const message = buildStudentSageMessage("Sam Rivera", groups);
  assert.match(message, /Sam Rivera/);
  assert.match(message, /- Wellbeing check-in needed \[URGENT\]/);
  assert.match(message, /- Title t1$/m);

  const all = buildQueueSageMessage([{ name: "Sam Rivera", groups }]);
  assert.match(all, /2 open issues across 1 student\b/);
});
