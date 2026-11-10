import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueueAlert } from "@/lib/teacher/intervention-queue";
import { countUrgentStudents, findAlertTarget } from "./queue-alert-target";

function alert(id: string, severity: string, title = "Goal review"): QueueAlert {
  return {
    id,
    type: "goal_review_pending",
    severity,
    title,
    summary: "New evidence on a goal.",
    sourceType: null,
    sourceId: null,
    detectedAt: "2026-10-03T12:00:00.000Z",
  };
}

const QUEUE = [
  { name: "Sam Rivera", openAlerts: [alert("c1", "critical", "Wellbeing check"), alert("m1", "medium")] },
  { name: "Ana Lopez", openAlerts: [alert("h1", "high")] },
  { name: "Jo Park", openAlerts: [alert("l1", "low")] },
];

const nothingDone = () => false;

describe("findAlertTarget", () => {
  it("gives the alert's title and its student's name for the confirm", () => {
    assert.deepEqual(findAlertTarget(QUEUE, "c1"), {
      id: "c1",
      severity: "critical",
      title: "Wellbeing check",
      studentName: "Sam Rivera",
    });
  });

  it("treats an alert it cannot find as critical, so it asks first", () => {
    assert.equal(findAlertTarget(QUEUE, "gone").severity, "critical");
  });
});

describe("countUrgentStudents", () => {
  it("counts students with an urgent alert open", () => {
    assert.equal(countUrgentStudents(QUEUE, nothingDone), 2);
  });

  it("does not count an alert line shown as done", () => {
    assert.equal(countUrgentStudents(QUEUE, (id) => id === "h1"), 1);
    assert.equal(countUrgentStudents(QUEUE, (id) => id === "c1" || id === "h1"), 0);
  });

  it("still counts a student whose other urgent alert is open", () => {
    const two = [{ name: "Sam Rivera", openAlerts: [alert("c1", "critical"), alert("c2", "critical")] }];
    assert.equal(countUrgentStudents(two, (id) => id === "c1"), 1);
  });
});
