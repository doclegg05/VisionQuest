import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import {
  createStudentAlertStore,
  OVERDUE_TASK_ALERT,
  STUDENT_ID,
} from "@/lib/student-alerts.test-support";

// Module mocks, registered before the page is imported. The prisma stand-in
// applies the where clause, so a page that queries StudentAlert without a
// type filter receives the staff rows exactly as production would.
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      appointment: { findMany: async () => [] },
      studentTask: { findMany: async () => [] },
      studentAlert: createStudentAlertStore(),
    },
  },
});

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => ({
      id: STUDENT_ID,
      studentId: STUDENT_ID,
      displayName: "Test Student",
      role: "student",
    }),
  },
});

mock.module("@/lib/advising", {
  namedExports: { listBookableAdvisors: async () => [] },
});

interface HubAlert {
  id: string;
  severity: string;
  title: string;
  summary: string;
  detectedAt: string;
}

const hubRenders: Array<{ alerts: HubAlert[] }> = [];

mock.module("@/components/advising/StudentAdvisingHub", {
  defaultExport: (props: { alerts: HubAlert[] }) => {
    hubRenders.push(props);
    return null;
  },
});

let AppointmentsPage: typeof import("./page").default;

before(async () => {
  AppointmentsPage = (await import("./page")).default;
});

describe("AppointmentsPage alerts", () => {
  it("passes the hub only the student's follow-up alerts; the staff wellbeing card never reaches the student", async () => {
    renderToString(await AppointmentsPage());

    const hub = hubRenders.at(-1);
    assert.ok(hub, "StudentAdvisingHub was not rendered");
    assert.deepEqual(
      hub.alerts.map((alert) => alert.id),
      [OVERDUE_TASK_ALERT.id],
    );

    const text = JSON.stringify(hub.alerts);
    assert.ok(!text.includes("call 911"), "the staff crisis checklist reached the student");
    assert.ok(!text.includes("Archive review"), "inactivity triage reached the student");
  });
});
