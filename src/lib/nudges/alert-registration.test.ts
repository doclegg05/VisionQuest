import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { NUDGE_ALERT_TYPES } from "./schedule-shared";
import { STUDENT_VISIBLE_ALERT_TYPES } from "@/lib/student-alerts";
import {
  teacherDashboardAlertAction,
  teacherDashboardAlertQuickAction,
} from "@/lib/intervention-notifications";

/**
 * The dead-end-row gate the 2026-07 review asked for.
 *
 * A StudentAlert type that no surface knows about still RENDERS — it just
 * renders as a row with a generic label, no priority, and a button that goes
 * nowhere. That is worse than not raising it: the instructor sees a task they
 * cannot act on, learns the queue contains noise, and starts skimming past
 * rows that matter. Every type this feature can write is therefore pinned
 * against every place a queue reads one.
 */

const root = join(process.cwd(), "src");

function source(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

/** The staff types: everything the feature raises except the student's own card. */
const STAFF_TYPES = Object.values(NUDGE_ALERT_TYPES).filter(
  (type) => !(STUDENT_VISIBLE_ALERT_TYPES as readonly string[]).includes(type),
);

describe("every nudge alert type is registered where a queue reads one", () => {
  it("has staff types to check, and exactly one student-visible one", () => {
    assert.equal(STAFF_TYPES.length, Object.values(NUDGE_ALERT_TYPES).length - 1);
    assert.ok(STAFF_TYPES.length >= 5, `only ${STAFF_TYPES.length} staff types found`);
  });

  it("gives every staff type a consolidation label", () => {
    const queue = source("components/teacher/InterventionQueue.tsx");
    const groups = queue.slice(
      queue.indexOf("const CONSOLIDATION_GROUPS"),
      queue.indexOf("interface ConsolidatedItem"),
    );
    for (const type of STAFF_TYPES) {
      assert.ok(groups.includes(`${type}:`), `${type} has no CONSOLIDATION_GROUPS label`);
    }
  });

  it("gives every staff type a queue priority", () => {
    const file = source("lib/teacher/intervention-queue.ts");
    const table = file.slice(
      file.indexOf("const ALERT_TYPE_PRIORITY"),
      file.indexOf("function severityRank"),
    );
    for (const type of STAFF_TYPES) {
      assert.ok(table.includes(`${type}:`), `${type} has no ALERT_TYPE_PRIORITY entry`);
    }
  });

  it("gives every staff type an action that goes somewhere real", () => {
    for (const type of STAFF_TYPES) {
      const action = teacherDashboardAlertAction(type, "clstudent0000000000000000");
      assert.ok(action.href, `${type} has no action href`);
      assert.ok(
        action.href.startsWith("/teacher/"),
        `${type} points outside the staff app: ${action.href}`,
      );
      assert.ok(action.label.length > 0, `${type} has no action label`);
      assert.notEqual(action.label, "Open student", `${type} fell through to the default action`);
      assert.ok(teacherDashboardAlertQuickAction(type), `${type} has no quick action`);
    }
  });

  it("keeps the student's own card OUT of the staff dashboard query", () => {
    // It resolves when they open /career and there is nothing staff can do
    // about it; a row nobody can action teaches people to skim the queue.
    const dashboard = source("lib/teacher/dashboard.ts");
    assert.match(dashboard, /NUDGE_ALERT_TYPES\.weeklyJobsReady/);
    assert.ok(
      dashboard.includes("notIn: [...ALL_INACTIVITY_ALERT_TYPES, NUDGE_ALERT_TYPES.weeklyJobsReady]"),
      "the staff dashboard query must exclude connect_weekly_jobs_ready",
    );
  });

  it("keeps every staff type OUT of the student allowlist", () => {
    for (const type of STAFF_TYPES) {
      assert.ok(
        !(STUDENT_VISIBLE_ALERT_TYPES as readonly string[]).includes(type),
        `${type} must not be student-visible`,
      );
    }
  });
});
