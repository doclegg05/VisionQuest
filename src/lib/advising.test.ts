import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBookableAdvisorSlots,
  buildStudentAlertDescriptors,
} from "./advising";
import { buildStudentStatusSignals } from "./student-status";

test("buildStudentAlertDescriptors creates overdue task alerts with escalating severity", () => {
  const now = new Date("2026-03-13T17:00:00.000Z");
  const alerts = buildStudentAlertDescriptors({
    now,
    tasks: [
      {
        id: "task-medium",
        title: "Check in with advisor",
        dueAt: new Date("2026-03-12T20:00:00.000Z"),
      },
      {
        id: "task-high",
        title: "Upload resume",
        dueAt: new Date("2026-03-10T14:00:00.000Z"),
      },
    ],
    appointments: [],
  });

  assert.equal(alerts.length, 2);
  assert.equal(alerts[0]?.type, "overdue_task");
  assert.equal(alerts[0]?.severity, "medium");
  assert.equal(alerts[1]?.severity, "high");
});

test("buildStudentAlertDescriptors creates follow-up alerts for past appointments", () => {
  const now = new Date("2026-03-13T17:00:00.000Z");
  const alerts = buildStudentAlertDescriptors({
    now,
    tasks: [],
    appointments: [
      {
        id: "apt-1",
        title: "Weekly coaching",
        startsAt: new Date("2026-03-13T14:00:00.000Z"),
        endsAt: new Date("2026-03-13T14:30:00.000Z"),
      },
    ],
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.type, "missed_appointment");
  assert.equal(alerts[0]?.sourceId, "apt-1");
});

test("buildStudentAlertDescriptors adds inactivity and career momentum alerts", () => {
  const now = new Date("2026-03-13T17:00:00.000Z");
  const alerts = buildStudentAlertDescriptors({
    now,
    tasks: [],
    appointments: [],
    signals: {
      studentId: "student-1",
      studentCreatedAt: new Date("2026-02-01T12:00:00.000Z"),
      lastActivityAt: new Date("2026-02-26T15:00:00.000Z"),
      applicationCount: 0,
      eventRegistrationCount: 0,
      certification: null,
    },
  });

  assert.deepEqual(
    alerts.map((alert) => alert.type),
    ["inactive_student_14", "career_inactive"]
  );
  assert.equal(alerts[0]?.alertKey, "inactive_student:student-1");
  assert.equal(alerts[1]?.severity, "medium");
});

test("buildStudentAlertDescriptors escalates inactivity stages at 30, 60, and 90 days", () => {
  const now = new Date("2026-04-15T17:00:00.000Z");

  const thirtyDayAlert = buildStudentAlertDescriptors({
    now,
    tasks: [],
    appointments: [],
    signals: {
      studentId: "student-30",
      studentCreatedAt: new Date("2026-01-01T12:00:00.000Z"),
      lastActivityAt: new Date("2026-03-15T12:00:00.000Z"),
      applicationCount: 1,
      eventRegistrationCount: 0,
      certification: null,
    },
  })[0];

  const sixtyDayAlert = buildStudentAlertDescriptors({
    now,
    tasks: [],
    appointments: [],
    signals: {
      studentId: "student-60",
      studentCreatedAt: new Date("2026-01-01T12:00:00.000Z"),
      lastActivityAt: new Date("2026-02-14T12:00:00.000Z"),
      applicationCount: 1,
      eventRegistrationCount: 0,
      certification: null,
    },
  })[0];

  const ninetyDayAlert = buildStudentAlertDescriptors({
    now,
    tasks: [],
    appointments: [],
    signals: {
      studentId: "student-90",
      studentCreatedAt: new Date("2025-12-01T12:00:00.000Z"),
      lastActivityAt: new Date("2026-01-01T12:00:00.000Z"),
      applicationCount: 1,
      eventRegistrationCount: 0,
      certification: null,
    },
  })[0];

  assert.equal(thirtyDayAlert?.type, "inactive_student_30");
  assert.equal(sixtyDayAlert?.type, "inactive_student_60");
  assert.equal(ninetyDayAlert?.type, "inactive_student_90");
  assert.match(ninetyDayAlert?.summary || "", /archive/i);
});

test("buildStudentAlertDescriptors flags certifications that have stalled", () => {
  const now = new Date("2026-03-13T17:00:00.000Z");
  const alerts = buildStudentAlertDescriptors({
    now,
    tasks: [],
    appointments: [],
    signals: {
      studentId: "student-2",
      studentCreatedAt: new Date("2026-01-20T12:00:00.000Z"),
      lastActivityAt: new Date("2026-03-10T12:00:00.000Z"),
      applicationCount: 2,
      eventRegistrationCount: 1,
      certification: {
        status: "in_progress",
        startedAt: new Date("2026-02-01T12:00:00.000Z"),
        lastProgressAt: new Date("2026-02-10T12:00:00.000Z"),
        completedRequiredCount: 1,
        requiredCount: 5,
      },
    },
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.type, "certification_stalled");
  assert.equal(alerts[0]?.severity, "high");
});

test("buildStudentAlertDescriptors adds orientation follow-up alerts from shared student status", () => {
  const now = new Date("2026-03-13T17:00:00.000Z");
  const alerts = buildStudentAlertDescriptors({
    now,
    tasks: [],
    appointments: [],
    signals: {
      studentId: "student-3",
      studentCreatedAt: new Date("2026-03-01T12:00:00.000Z"),
      lastActivityAt: new Date("2026-03-12T12:00:00.000Z"),
      applicationCount: 0,
      eventRegistrationCount: 0,
      orientationStatus: buildStudentStatusSignals({
        formSubmissions: [
          {
            formId: "student-profile",
            status: "pending",
            updatedAt: "2026-03-09T12:00:00.000Z",
            reviewedAt: null,
            notes: null,
          },
          {
            formId: "rights-responsibilities",
            status: "rejected",
            updatedAt: "2026-03-10T12:00:00.000Z",
            reviewedAt: "2026-03-11T12:00:00.000Z",
            notes: "Please add initials",
          },
        ],
        orientationItems: [
          { id: "orientation-1", label: "Meet your instructor", required: true },
          { id: "orientation-2", label: "Review class expectations", required: true },
        ],
        orientationProgress: [],
      }),
      certification: null,
    },
  });

  assert.ok(alerts.some((alert) => alert.type === "orientation_form_missing"));
  assert.ok(alerts.some((alert) => alert.type === "orientation_form_pending_review"));
  assert.ok(alerts.some((alert) => alert.type === "orientation_form_revision_needed"));
  assert.ok(alerts.some((alert) => alert.type === "orientation_item_incomplete"));
});

test("buildBookableAdvisorSlots excludes booked slots and sorts the remainder", () => {
  const now = new Date("2026-03-16T12:00:00.000Z");
  const advisors = buildBookableAdvisorSlots({
    now,
    days: 3,
    minimumLeadMinutes: 0,
    maxSlotsPerAdvisor: 10,
    advisors: [
      {
        id: "block-1",
        advisorId: "teacher-1",
        advisorName: "Avery Coach",
        advisorEmail: "avery@example.com",
        weekday: 1,
        startMinutes: 9 * 60,
        endMinutes: 11 * 60,
        slotMinutes: 30,
        locationType: "virtual",
        locationLabel: "Zoom",
        meetingUrl: null,
        active: true,
      },
    ],
    appointments: [
      {
        advisorId: "teacher-1",
        startsAt: new Date("2026-03-16T13:30:00.000Z"),
        endsAt: new Date("2026-03-16T14:00:00.000Z"),
        status: "scheduled",
      },
    ],
  });

  assert.equal(advisors.length, 1);
  assert.equal(advisors[0]?.slots.length, 3);
  assert.deepEqual(
    advisors[0]?.slots.map((slot) => slot.startsAt),
    [
      "2026-03-16T13:00:00.000Z",
      "2026-03-16T14:00:00.000Z",
      "2026-03-16T14:30:00.000Z",
    ]
  );
});

test("buildBookableAdvisorSlots respects minimum lead time", () => {
  const now = new Date("2026-03-16T12:15:00.000Z");
  const advisors = buildBookableAdvisorSlots({
    now,
    days: 1,
    minimumLeadMinutes: 60,
    maxSlotsPerAdvisor: 10,
    advisors: [
      {
        id: "block-1",
        advisorId: "teacher-1",
        advisorName: "Avery Coach",
        advisorEmail: "avery@example.com",
        weekday: 1,
        startMinutes: 8 * 60,
        endMinutes: 11 * 60,
        slotMinutes: 30,
        locationType: "virtual",
        locationLabel: "Zoom",
        meetingUrl: null,
        active: true,
      },
    ],
    appointments: [],
  });

  assert.equal(advisors.length, 1);
  assert.deepEqual(
    advisors[0]?.slots.map((slot) => slot.startsAt),
    [
      "2026-03-16T13:30:00.000Z",
      "2026-03-16T14:00:00.000Z",
      "2026-03-16T14:30:00.000Z",
    ]
  );
});
