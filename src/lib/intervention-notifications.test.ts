import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudentInterventionNotifications,
  buildTeacherInterventionNotifications,
  studentInterventionHref,
  teacherDashboardAlertAction,
  teacherDashboardAlertQuickAction,
  teacherDashboardReviewAction,
  teacherDashboardReviewQuickAction,
  teacherInterventionHref,
} from "./intervention-notifications";

test("buildStudentInterventionNotifications creates missing-form, revision, and due-soon nudges", () => {
  const notifications = buildStudentInterventionNotifications({
    now: new Date("2026-03-20T12:00:00.000Z"),
    alerts: [
      {
        type: "orientation_form_missing",
        title: "Required onboarding forms are still missing",
        summary: "Student Profile and Dress Code Policy still need to be submitted.",
      },
      {
        type: "orientation_form_revision_needed",
        title: "Onboarding forms were returned for revision",
        summary: "Rights and Responsibilities was returned and still needs student follow-up.",
      },
    ],
    evidenceEntries: [
      {
        goalId: "goal-1",
        linkId: "link-1",
        resourceType: "form",
        resourceId: "student-profile",
        title: "SPOKES Student Profile",
        linkStatus: "assigned",
        evidenceStatus: "not_started",
        evidenceSource: "none",
        reviewNeeded: false,
        evidenceLabel: "Waiting for activity",
        summary: "No student progress has been observed yet.",
        lastObservedAt: null,
        dueAt: "2026-03-21T12:00:00.000Z",
        notes: null,
      },
    ],
  });

  assert.ok(notifications.some((item) => item.type === "nudge.orientation_missing"));
  assert.ok(notifications.some((item) => item.type === "nudge.orientation_revision"));
  assert.ok(notifications.some((item) => item.type === "nudge.goal_due_soon"));
});

test("buildTeacherInterventionNotifications creates review and onboarding nudges", () => {
  const notifications = buildTeacherInterventionNotifications({
    studentName: "Jordan Lee",
    studentId: "STU-42",
    alerts: [
      {
        type: "orientation_form_pending_review",
        title: "Submitted onboarding forms need review",
        summary: "Student Profile is waiting for instructor review.",
      },
    ],
    reviewQueue: [
      {
        key: "goal_review_pending:link-1",
        kind: "goal_review_pending",
        severity: "medium",
        goalId: "goal-1",
        goalTitle: "Finish onboarding paperwork",
        linkId: "link-1",
        resourceTitle: "SPOKES Student Profile",
        summary: "SPOKES Student Profile has student work waiting for teacher review.",
        dueAt: null,
        detectedAt: "2026-03-20T10:00:00.000Z",
      },
    ],
  });

  assert.ok(notifications.some((item) => item.type === "teacher_nudge.orientation_review"));
  assert.ok(notifications.some((item) => item.type === "teacher_nudge.goal_review"));
  assert.ok(notifications.every((item) => item.body.includes("Jordan Lee (STU-42)")));
});

test("intervention routes map nudges and dashboard actions to the right pages", () => {
  assert.equal(studentInterventionHref("nudge.orientation_missing"), "/orientation");
  assert.equal(studentInterventionHref("nudge.goal_due_soon"), "/goals");
  assert.equal(
    teacherInterventionHref("teacher_nudge.orientation_review", "student-1"),
    "/teacher/students/student-1#submitted-forms",
  );
  assert.deepEqual(teacherDashboardAlertAction("orientation_item_incomplete", "student-1"), {
    href: "/teacher/students/student-1#orientation-review",
    label: "Open orientation",
  });
  assert.deepEqual(teacherDashboardReviewAction("goal_needs_resource", "student-1"), {
    href: "/teacher/students/student-1#goal-plans",
    label: "Assign support",
  });
  assert.deepEqual(teacherDashboardAlertQuickAction("orientation_form_pending_review"), {
    kind: "review_forms",
    label: "Quick review",
  });
  assert.deepEqual(teacherDashboardReviewQuickAction("goal_resource_stale"), {
    kind: "create_task",
    label: "Add task",
  });
});
