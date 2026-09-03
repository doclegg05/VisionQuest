import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import type { StudentNextStepResult } from "@/lib/progression/student-next-step";
import {
  createStudentAlertStore,
  makePreloadedReadiness,
  STUDENT_ID,
} from "@/lib/student-alerts.test-support";

// How many intake FormSubmission rows the student has. Mutable so a test can
// drive the signature banner's branch; 0 = the banner shows.
let intakeSubmissionCount = 0;

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
      formSubmission: { count: async () => intakeSubmissionCount },
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

mock.module("@/components/chat/ChatWindow", { defaultExport: () => null });
mock.module("@/components/dashboard/sage/SagePanels", {
  namedExports: { SagePanels: () => null },
});
mock.module("@/components/progression/PathToEmployment", {
  namedExports: { PathToEmployment: () => null },
});

const ambientRenders: Array<{ alertCount: number }> = [];

mock.module("@/components/dashboard/AmbientPanels", {
  namedExports: {
    AmbientPanels: (props: { alertCount: number }) => {
      ambientRenders.push(props);
      return null;
    },
  },
});

let DashboardPage: typeof import("./page").default;

before(async () => {
  DashboardPage = (await import("./page")).default;
});

describe("DashboardPage alert count", () => {
  it("counts only the student's follow-up alerts; the staff wellbeing card and inactivity row do not light the red card", async () => {
    renderToString(await DashboardPage());

    const ambient = ambientRenders.at(-1);
    assert.ok(ambient, "AmbientPanels was not rendered");
    assert.equal(ambient.alertCount, 1);
  });
});

describe("DashboardPage intake signature banner", () => {
  it("prompts the student when no intake submission exists yet", async () => {
    intakeSubmissionCount = 0;
    const html = renderToString(await DashboardPage());

    assert.match(html, /Sign your student profile form/);
    assert.match(html, /Your class hours only count once your signed form is on file\./);
  });

  it("sends a signed-in student to the authenticated orientation flow, never the anonymous intake form", async () => {
    intakeSubmissionCount = 0;
    const html = renderToString(await DashboardPage());

    assert.match(html, /href="\/orientation"/);
    // /intake is the public QR-code enrollment form. An authenticated student
    // must never be routed to it: it collects the identity they already have,
    // and it is the surface that used to hand out sessions.
    assert.doesNotMatch(html, /href="\/intake"/);
  });

  it("hides the banner once an intake submission is on file", async () => {
    intakeSubmissionCount = 1;
    try {
      const html = renderToString(await DashboardPage());
      assert.doesNotMatch(html, /Sign your student profile form/);
    } finally {
      intakeSubmissionCount = 0;
    }
  });
});
