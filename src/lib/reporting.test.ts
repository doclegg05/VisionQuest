import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * getTeacherOutcomeReport — urgent alert counts.
 *
 * Crisis alerts are written with severity "critical"
 * (src/lib/sage/crisis-detection.ts), one rank above "high". The report's
 * urgent count, its summary total and its attention-queue order must all
 * treat a critical alert as at least as urgent as a high one.
 */

interface AlertRow {
  id: string;
  severity: string;
  title: string;
}

let students: unknown[] = [];

function studentRow(id: string, displayName: string, alerts: AlertRow[]) {
  return {
    id,
    studentId: `S-${id}`,
    displayName,
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    alerts,
    conversations: [],
    goals: [],
    portfolioItems: [],
    files: [],
    orientationProgress: [],
    assignedTasks: [],
    appointments: [],
    applications: [],
    eventRegistrations: [],
    certifications: [],
    publicCredentialPage: null,
  };
}

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      orientationItem: { count: async () => 0 },
      student: { findMany: async () => students },
      application: { findMany: async () => [] },
      opportunity: { count: async () => 0 },
      careerEvent: { findMany: async () => [] },
    },
  },
});

let getTeacherOutcomeReport: typeof import("./reporting").getTeacherOutcomeReport;
before(async () => {
  ({ getTeacherOutcomeReport } = await import("./reporting"));
});

const CRISIS: AlertRow = { id: "a-crisis", severity: "critical", title: "Wellbeing check-in needed" };
const HIGH: AlertRow = { id: "a-high", severity: "high", title: "Inactive for 14 days" };
const MEDIUM_1: AlertRow = { id: "a-med-1", severity: "medium", title: "Goal needs review" };
const MEDIUM_2: AlertRow = { id: "a-med-2", severity: "medium", title: "Overdue task" };

describe("getTeacherOutcomeReport urgent alerts", () => {
  beforeEach(() => {
    students = [
      studentRow("crisis", "Avery Crisis", [CRISIS]),
      studentRow("high", "Blake High", [HIGH]),
      studentRow("medium", "Casey Medium", [MEDIUM_1, MEDIUM_2]),
    ];
  });

  it("counts a critical alert as urgent for its student", async () => {
    const report = await getTeacherOutcomeReport();
    const crisis = report.attentionQueue.find((student) => student.id === "crisis");
    assert.equal(crisis?.highSeverityAlertCount, 1);
  });

  it("includes critical alerts in the summary's urgent total", async () => {
    const report = await getTeacherOutcomeReport();
    assert.equal(report.summary.highSeverityAlerts, 2);
  });

  it("puts a student with a critical alert ahead of one with only medium alerts", async () => {
    const report = await getTeacherOutcomeReport();
    const order = report.attentionQueue.map((student) => student.id);
    assert.ok(
      order.indexOf("crisis") < order.indexOf("medium"),
      `expected crisis before medium, got ${order.join(", ")}`,
    );
  });
});
