import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpokesSummary,
  getChecklistProgress,
  getEmploymentFollowUpSchedule,
  getModuleProgress,
  splitDisplayName,
} from "./spokes";

test("splitDisplayName creates a usable SPOKES name from display text", () => {
  assert.deepEqual(splitDisplayName("Avery Marie Coach"), {
    firstName: "Avery",
    lastName: "Marie Coach",
  });
});

test("getChecklistProgress only counts active required items in a category", () => {
  const result = getChecklistProgress(
    [
      { id: "orientation-1", category: "orientation", required: true, active: true },
      { id: "orientation-2", category: "orientation", required: true, active: true },
      { id: "file-1", category: "program_file", required: true, active: true },
      { id: "optional", category: "orientation", required: false, active: true },
    ],
    [{ templateId: "orientation-1", completed: true }],
    "orientation"
  );

  assert.deepEqual(result, {
    done: 1,
    total: 2,
    isComplete: false,
  });
});

test("getModuleProgress only counts required active modules", () => {
  const result = getModuleProgress(
    [
      { id: "module-1", required: true, active: true },
      { id: "module-2", required: true, active: true },
      { id: "module-3", required: false, active: true },
    ],
    [{ templateId: "module-1", completedAt: new Date("2026-03-01T00:00:00.000Z") }]
  );

  assert.deepEqual(result, {
    done: 1,
    total: 2,
    isComplete: false,
  });
});

test("getEmploymentFollowUpSchedule marks due checkpoints when employment follow-ups are missing", () => {
  const now = new Date("2026-03-13T12:00:00.000Z");
  const schedule = getEmploymentFollowUpSchedule(
    new Date("2025-12-01T00:00:00.000Z"),
    [{ checkpointMonths: 1, status: "employed", checkedAt: new Date("2026-01-02T00:00:00.000Z") }],
    now
  );

  assert.equal(schedule[0]?.status, "completed");
  assert.equal(schedule[1]?.status, "due");
  assert.equal(schedule[2]?.status, "upcoming");
});

test("buildSpokesSummary combines checklist, module, and follow-up status", () => {
  const summary = buildSpokesSummary({
    record: {
      status: "enrolled",
      referralDate: new Date("2026-01-01T00:00:00.000Z"),
      enrolledAt: new Date("2026-01-10T00:00:00.000Z"),
      familySurveyOfferedAt: null,
      postSecondaryEnteredAt: null,
      unsubsidizedEmploymentAt: new Date("2026-01-15T00:00:00.000Z"),
      exitDate: null,
      nonCompleterAt: null,
    },
    checklistTemplates: [
      { id: "orientation-1", category: "orientation", required: true, active: true },
      { id: "file-1", category: "program_file", required: true, active: true },
    ],
    checklistProgress: [
      { templateId: "orientation-1", completed: true },
      { templateId: "file-1", completed: false },
    ],
    moduleTemplates: [{ id: "module-1", required: true, active: true }],
    moduleProgress: [{ templateId: "module-1", completedAt: new Date("2026-01-20T00:00:00.000Z") }],
    employmentFollowUps: [],
    now: new Date("2026-03-13T12:00:00.000Z"),
  });

  assert.equal(summary.orientation.isComplete, true);
  assert.equal(summary.programFiles.isComplete, false);
  assert.equal(summary.modules.isComplete, true);
  assert.equal(summary.employmentFollowUpsDue, 1);
});
