import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Moved from src/app/api/cron/evidence-gap-detection/route.test.ts when the
// detector moved to this module (#240, #247). The certification rule is
// isCertificationRequirementMet in src/lib/certifications.ts (#254).

const STUDENT_ID = "student-1";
const CLASS_ID = "class-1";

function certRequirement(itemId: string) {
  return {
    id: `req-${itemId}`,
    classId: CLASS_ID,
    title: itemId,
    itemType: "certification",
    itemId,
    status: "required",
  };
}

let certRows: Array<{ studentId: string; certType: string; status: string }> = [];
const upsertedAlertKeys: string[] = [];

const tx = {
  studentAlert: {
    findMany: async () => [],
    upsert: async (args: { where: { alertKey: string } }) => {
      upsertedAlertKeys.push(args.where.alertKey);
      return {};
    },
    update: async () => ({}),
    updateMany: async () => ({ count: 0 }),
  },
};

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      studentClassEnrollment: {
        findMany: async () => [
          { studentId: STUDENT_ID, classId: CLASS_ID, enrolledAt: new Date("2026-10-01") },
        ],
      },
      classRequirement: {
        findMany: async () => [
          certRequirement("ready-to-work"),
          certRequirement("workkeys-ncrc"),
          certRequirement("ic3"),
        ],
      },
      certification: { findMany: async () => certRows },
      orientationProgress: { findMany: async () => [] },
      formSubmission: { findMany: async () => [] },
      progression: { findMany: async () => [] },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    },
  },
});

let runEvidenceGapDetection: typeof import("./evidence-gap-detection").runEvidenceGapDetection;

before(async () => {
  ({ runEvidenceGapDetection } = await import("./evidence-gap-detection"));
});

describe("runEvidenceGapDetection: certification requirements", () => {
  beforeEach(() => {
    upsertedAlertKeys.length = 0;
    certRows = [];
  });

  it("keeps the WorkKeys NCRC gap open when only Ready to Work is complete", async () => {
    certRows = [{ studentId: STUDENT_ID, certType: "ready-to-work", status: "completed" }];

    await runEvidenceGapDetection(new Date("2026-10-16T12:00:00Z"));

    assert.deepEqual(upsertedAlertKeys, [
      `evidence_gap:${STUDENT_ID}:req-workkeys-ncrc`,
      `evidence_gap:${STUDENT_ID}:req-ic3`,
    ]);
  });

  it("opens no Ready to Work gap when the student's Ready to Work row is labelled workkeys-ncrc", async () => {
    certRows = [{ studentId: STUDENT_ID, certType: "workkeys-ncrc", status: "completed" }];

    await runEvidenceGapDetection(new Date("2026-10-16T12:00:00Z"));

    assert.deepEqual(upsertedAlertKeys, [`evidence_gap:${STUDENT_ID}:req-ic3`]);
  });
});
