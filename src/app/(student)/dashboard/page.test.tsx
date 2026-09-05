import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import type { StudentNextStepResult } from "@/lib/progression/student-next-step";
import {
  createStudentAlertStore,
  makePreloadedReadiness,
  STUDENT_ID,
} from "@/lib/student-alerts.test-support";

// Module mocks, registered before the page is imported. Only the alert count
// is under test; every other read returns the quietest value that keeps the
// page off the welcome redirect (one goal, orientation complete).
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      goal: { count: async () => 1 },
      appointment: { findFirst: async () => null },
      studentTask: { findMany: async () => [] },
      studentAlert: createStudentAlertStore(),
      orientationItem: { findMany: async () => [] },
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
