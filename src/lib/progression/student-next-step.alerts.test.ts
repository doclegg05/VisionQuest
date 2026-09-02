import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import type { StudentNextStepResult } from "./student-next-step";
import {
  createStudentAlertStore,
  makePreloadedReadiness,
  STUDENT_ID,
  WELLBEING_ONLY_STUDENT_ID,
} from "@/lib/student-alerts.test-support";

// getStudentNextStep runs ten counts in parallel; every one except the alert
// count returns zero so the follow-up step's status is decided by alerts alone.
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      careerDiscovery: { findUnique: async () => null },
      goal: { count: async () => 0 },
      message: { count: async () => 0 },
      studentSavedJob: { count: async () => 0 },
      application: { count: async () => 0 },
      studentAlert: createStudentAlertStore(),
      studentTask: { count: async () => 0 },
    },
  },
});

mock.module("./fetch-readiness-data", {
  namedExports: {
    fetchStudentReadinessData: async () => {
      throw new Error("readiness is preloaded in this test");
    },
  },
});

let getStudentNextStep: typeof import("./student-next-step").getStudentNextStep;

before(async () => {
  ({ getStudentNextStep } = await import("./student-next-step"));
});

function followUpStatus(result: StudentNextStepResult) {
  return result.steps.find((step) => step.key === "followUp")?.status;
}

describe("getStudentNextStep and staff alerts", () => {
  it("does not show a blocked follow-up step to a student whose only open alert is the wellbeing card", async () => {
    const result = await getStudentNextStep(WELLBEING_ONLY_STUDENT_ID, makePreloadedReadiness());

    assert.notEqual(followUpStatus(result), "blocked");
  });

  it("still blocks the step for an open overdue follow-up task", async () => {
    const result = await getStudentNextStep(STUDENT_ID, makePreloadedReadiness());

    assert.equal(followUpStatus(result), "blocked");
  });
});
