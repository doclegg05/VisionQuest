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
  queueBodyView,
  visibleQueueRows,
  withPinnedRow,
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

test("unconfirmed goals fold into one counted group", () => {
  const groups = groupQueueIssues(
    ["u1", "u2", "u3"].map((id) => alert(id, "goal_unconfirmed", "medium", "Sage-proposed goal awaiting confirmation")),
    STUDENT,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.count, 3);
  assert.equal(groups[0]?.category, "Goals");
  assert.equal(groups[0]?.label, "3 goals awaiting confirmation");
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

test("a pinned row beyond the first view is added back in queue order", () => {
  const all = Array.from({ length: 14 }, (_, index) => ({ studentId: `s${index + 1}` }));
  const visible = all.slice(0, 10);
  const pinned = withPinnedRow(visible, all, "s13");
  assert.deepEqual(pinned.map((row) => row.studentId), ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s13"]);
  const between = withPinnedRow([all[0]!, all[11]!], all, "s6");
  assert.deepEqual(between.map((row) => row.studentId), ["s1", "s6", "s12"]);
});

test("a pinned row that is already visible is not duplicated", () => {
  const all = Array.from({ length: 12 }, (_, index) => ({ studentId: `s${index + 1}` }));
  const visible = all.slice(0, 10);
  const pinned = withPinnedRow(visible, all, "s4");
  assert.deepEqual(pinned.map((row) => row.studentId), visible.map((row) => row.studentId));
});

test("no pinned id, or one that left the queue, changes nothing", () => {
  const all = Array.from({ length: 12 }, (_, index) => ({ studentId: `s${index + 1}` }));
  const visible = all.slice(0, 10);
  assert.deepEqual(withPinnedRow(visible, all, null), visible);
  assert.deepEqual(withPinnedRow(visible, all, "gone"), visible);
});

test("a failed refresh keeps the last good list on screen, marked stale", () => {
  assert.deepEqual(queueBodyView({ loading: false, failed: true, rowCount: 3 }), { kind: "list", stale: true });
  assert.deepEqual(queueBodyView({ loading: false, failed: false, rowCount: 3 }), { kind: "list", stale: false });
});

test("the in-place error shows only when there are no rows to fall back on", () => {
  assert.deepEqual(queueBodyView({ loading: false, failed: true, rowCount: 0 }), { kind: "error" });
  assert.deepEqual(queueBodyView({ loading: false, failed: false, rowCount: 0 }), { kind: "empty" });
});

test("loading shows the skeleton whatever else is true", () => {
  assert.deepEqual(queueBodyView({ loading: true, failed: false, rowCount: 0 }), { kind: "loading" });
  assert.deepEqual(queueBodyView({ loading: true, failed: true, rowCount: 3 }), { kind: "loading" });
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

test("the Sage prioritize message says 'issue' for one", () => {
  const groups = groupQueueIssues([alert("t1", "overdue_task")], STUDENT);
  const all = buildQueueSageMessage([{ name: "Sam Rivera", groups }]);
  assert.match(all, /1 open issue across 1 student\b/);
  assert.doesNotMatch(all, /open issues/);
});

test("the Sage prioritize message counts each row's alerts, not its groups", () => {
  const groups = groupQueueIssues(
    [
      alert("t1", "overdue_task", "high"),
      alert("t2", "overdue_task", "high"),
      alert("m1", "missed_appointment"),
      alert("m2", "missed_appointment"),
      alert("m3", "missed_appointment"),
    ],
    STUDENT,
  );
  assert.equal(groups.length, 2, "precondition: five alerts fold into two groups");
  const all = buildQueueSageMessage([{ name: "Sam Rivera", groups }]);
  assert.match(all, /5 open issues across 1 student\b/);
  assert.match(all, /^Sam Rivera: 2 urgent, 5 total$/m);
});

test("the Sage prioritize message counts urgent alerts by their own severity, not their group's", () => {
  // One overdue task is 48 hours late (high), the other 12 (medium). They fold
  // into one group, which reads as urgent because its top alert is, but only one
  // alert in it is urgent, and Sage compares students by this number.
  const groups = groupQueueIssues([alert("t1", "overdue_task", "high"), alert("t2", "overdue_task", "medium")], STUDENT);
  assert.equal(groups.length, 1, "precondition: both tasks fold into one group");
  const all = buildQueueSageMessage([{ name: "Sam Rivera", groups }]);
  assert.match(all, /^Sam Rivera: 1 urgent, 2 total$/m);
});
