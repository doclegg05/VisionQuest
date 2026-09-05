import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { before, beforeEach, describe, it, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { ALL_INACTIVITY_ALERT_TYPES } from "./inactivity";
import { NUDGE_ALERT_TYPES } from "./nudges/schedule-shared";
import { WELLBEING_ALERT_TYPE } from "./sage/wellbeing-card";
import {
  createStudentAlertStore,
  OVERDUE_TASK_ALERT,
  STUDENT_ID,
  WELLBEING_ONLY_STUDENT_ID,
} from "./student-alerts.test-support";

const store = createStudentAlertStore();

mock.module("@/lib/db", {
  namedExports: { prisma: { studentAlert: store } },
});

let helper: typeof import("./student-alerts");

before(async () => {
  helper = await import("./student-alerts");
});

beforeEach(() => {
  store.findMany.mock.resetCalls();
  store.count.mock.resetCalls();
});

const EXPECTED_WHERE = {
  studentId: STUDENT_ID,
  status: "open",
  type: { in: ["overdue_task", "missed_appointment", "connect_weekly_jobs_ready"] },
};

describe("STUDENT_VISIBLE_ALERT_TYPES", () => {
  it("is exactly the types written for a student to read", () => {
    assert.deepEqual(
      [...helper.STUDENT_VISIBLE_ALERT_TYPES],
      ["overdue_task", "missed_appointment", "connect_weekly_jobs_ready"],
    );
  });

  it("never admits the wellbeing crisis card or an inactivity stage", () => {
    const visible: readonly string[] = helper.STUDENT_VISIBLE_ALERT_TYPES;
    assert.ok(!visible.includes(WELLBEING_ALERT_TYPE));
    for (const type of ALL_INACTIVITY_ALERT_TYPES) {
      assert.ok(!visible.includes(type), `${type} must stay staff-only`);
    }
  });

  it("admits only the ONE Match & Connect nudge type the student asked for", () => {
    // The other four are instructor triage: an employer who has not opened a
    // packet, one who has not answered, an unconfirmed interview, and a lost
    // placement. Each names an employer and second-guesses the student.
    const visible: readonly string[] = helper.STUDENT_VISIBLE_ALERT_TYPES;
    for (const type of Object.values(NUDGE_ALERT_TYPES)) {
      const expected = type === NUDGE_ALERT_TYPES.weeklyJobsReady;
      assert.equal(visible.includes(type), expected, `${type} visibility`);
    }
  });
});

describe("listStudentVisibleAlerts", () => {
  it("scopes the query to the student's own open alerts of an allowlisted type", async () => {
    await helper.listStudentVisibleAlerts(STUDENT_ID);

    assert.equal(store.findMany.mock.callCount(), 1);
    const call = store.findMany.mock.calls[0].arguments[0];
    assert.deepEqual(call.where, EXPECTED_WHERE);
    // `type` is selected on purpose (Match & Connect Phase 5): the Advising
    // page renders `connect_weekly_jobs_ready` as an answer with a link rather
    // than as a triage card, so it needs to tell the allowlisted types apart.
    // The pin stays exact so a future select cannot quietly widen.
    assert.deepEqual(call.select, {
      id: true,
      type: true,
      severity: true,
      title: true,
      summary: true,
      detectedAt: true,
    });
  });

  it("returns the overdue task and drops the wellbeing card, the inactivity row, and the resolved task", async () => {
    const alerts = await helper.listStudentVisibleAlerts(STUDENT_ID);

    assert.deepEqual(
      alerts.map((alert) => alert.id),
      [OVERDUE_TASK_ALERT.id],
    );
    const text = JSON.stringify(alerts);
    assert.ok(!text.includes("call 911"), "the staff crisis checklist must never leave this helper");
    assert.ok(!text.includes("Archive review"), "inactivity triage must never leave this helper");
  });

  it("returns nothing for a student whose only open alert is the wellbeing card", async () => {
    assert.deepEqual(await helper.listStudentVisibleAlerts(WELLBEING_ONLY_STUDENT_ID), []);
  });
});

describe("countStudentVisibleAlerts", () => {
  it("builds the same where clause as the list, so Home and Advising cannot drift", async () => {
    await helper.listStudentVisibleAlerts(STUDENT_ID);
    await helper.countStudentVisibleAlerts(STUDENT_ID);

    assert.deepEqual(
      store.count.mock.calls[0].arguments[0].where,
      store.findMany.mock.calls[0].arguments[0].where,
    );
  });

  it("counts 1 when an overdue task, a wellbeing card, and an inactivity row are all open", async () => {
    assert.equal(await helper.countStudentVisibleAlerts(STUDENT_ID), 1);
  });

  it("counts 0 for a student whose only open alert is the wellbeing card", async () => {
    assert.equal(await helper.countStudentVisibleAlerts(WELLBEING_ONLY_STUDENT_ID), 0);
  });
});

describe("student surfaces read StudentAlert only through this helper", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const studentAppDir = join(root, "src", "app", "(student)");

  function sourceFilesUnder(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFilesUnder(path);
      if (!/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) return [];
      return [path];
    });
  }

  it("no student page, and not the Home next-step engine, calls prisma.studentAlert directly", () => {
    const files = [
      ...sourceFilesUnder(studentAppDir),
      join(root, "src", "lib", "progression", "student-next-step.ts"),
    ];
    assert.ok(files.length > 1, "expected student pages to scan");

    for (const file of files) {
      assert.ok(
        !readFileSync(file, "utf8").includes("studentAlert."),
        `${file} must read alerts through src/lib/student-alerts.ts`,
      );
    }
  });
});
