import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import type { StudentNextStepResult } from "@/lib/progression/student-next-step";
import {
  createStudentAlertStore,
  makePreloadedReadiness,
  STUDENT_ID,
} from "@/lib/student-alerts.test-support";

// Node does not process CSS modules; the browser harness verifies their real styles.
mock.module("@/components/dashboard/dashboard.module.css", { defaultExport: { workspace: "workspace" } });


// Module mocks, registered before the page is imported. Every read not under
// test returns the quietest value that keeps the page off the welcome redirect
// (one goal, orientation complete).
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      goal: { count: async () => 1 },
      appointment: { findFirst: async () => null },
      studentTask: { findMany: async () => [] },
      studentAlert: createStudentAlertStore(),
      orientationItem: { findMany: async () => [] },
      // R5: the dashboard reads no intake form submissions. A read here fails the render.
      formSubmission: { count: async () => { throw new Error("the dashboard must not read intake form submissions"); } },
      // The SMS re-consent notice reads the student's own preference row.
      // Null = never set one up, which is the case for this fixture and for
      // most students; the notice renders for nobody here.
      notificationPreference: { findUnique: async () => null },
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

mock.module("@/lib/progression/fetch-readiness-data", {
  namedExports: { fetchStudentReadinessData: async () => makePreloadedReadiness() },
});

mock.module("@/lib/sage/panel-data", {
  namedExports: { getLatestPanelSpec: async () => null },
});

const nextStep: StudentNextStepResult = {
  currentStepKey: "followUp",
  title: "Keep your applications moving",
  description: "",
  whyItMatters: "",
  actionLabel: "View Career Hub",
  actionLink: "/career",
  steps: [],
};

mock.module("@/lib/progression/student-next-step", {
  namedExports: {
    getStudentNextStep: async () => nextStep,
    nextStepShortLabel: () => null,
  },
});

// Renders only the intro slot: the header and signature banner the page passes in.
mock.module("./DashboardClient", { defaultExport: (props: { initialSupport?: { alertCount: number }; intro?: ReactNode }) => {
  if (props.initialSupport) ambientRenders.push(props.initialSupport);
  return props.intro ?? null;
} });
mock.module("@/lib/dashboard/readers", { namedExports: {
  readOverview: async () => ({ outcomes: [], fetchedAt: new Date().toISOString() }),
  readActivity: async () => ({ statuses: [], completions: [], unknownCompletionDates: 0, fetchedAt: new Date().toISOString() }),
} });
mock.module("@/lib/dashboard/tasks", { namedExports: {
  readTasks: async () => ({ tasks: [], total: 0, page: 1, pageSize: 10, fetchedAt: new Date().toISOString() }),
} });
mock.module("@/components/dashboard/sage/SagePanels", {
  namedExports: { SagePanels: () => null },
});
mock.module("@/components/progression/PathToEmployment", {
  namedExports: { PathToEmployment: () => null },
});

const ambientRenders: Array<{ alertCount: number }> = [];

let DashboardPage: typeof import("./page").default;

before(async () => {
  DashboardPage = (await import("./page")).default;
});

describe("DashboardPage alert count", () => {
  it("counts only the student's follow-up alerts; the staff wellbeing card and inactivity row do not light the red card", async () => {
    renderToString(await DashboardPage());

    const ambient = ambientRenders.at(-1);
    assert.ok(ambient, "Dashboard support was not provided");
    assert.equal(ambient.alertCount, 1);
  });
});

describe("DashboardPage signed-form banner (R5)", () => {
  // No page a student can open is able to sign the Student Profile form, so a
  // banner asking for it could never be cleared. The instructor roster carries
  // the "Missing intake" signal instead.
  it("shows no signed-form banner to any student", async () => {
    const html = renderToString(await DashboardPage());

    assert.doesNotMatch(html, /Sign Your Student Profile Form/);
    assert.doesNotMatch(html, /class hours only count/i);
    assert.doesNotMatch(html, /Student profile signature/);
  });

  it("never sends a signed-in student to the anonymous intake form", async () => {
    const html = renderToString(await DashboardPage());

    // /intake is the public QR-code enrollment form. It collects the identity
    // the student already has, and it is the surface that used to hand out sessions.
    assert.doesNotMatch(html, /href="\/intake"/);
  });
});
