import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

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

let POST: typeof import("./route").POST;

before(async () => {
  ({ POST } = await import("./route"));
});

function cronRequest() {
  return new Request("http://localhost/api/cron/evidence-gap-detection", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
  });
}

describe("POST /api/cron/evidence-gap-detection: certification requirements", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    upsertedAlertKeys.length = 0;
    certRows = [];
  });

  it("keeps the WorkKeys NCRC gap open when only Ready to Work is complete", async () => {
    certRows = [{ studentId: STUDENT_ID, certType: "ready-to-work", status: "completed" }];

    const res = await POST(cronRequest());

    assert.equal(res.status, 200);
    assert.deepEqual(upsertedAlertKeys, [
      `evidence_gap:${STUDENT_ID}:req-workkeys-ncrc`,
      `evidence_gap:${STUDENT_ID}:req-ic3`,
    ]);
  });

  it("opens no Ready to Work gap when the student's Ready to Work row is labelled workkeys-ncrc", async () => {
    certRows = [{ studentId: STUDENT_ID, certType: "workkeys-ncrc", status: "completed" }];

    const res = await POST(cronRequest());

    assert.equal(res.status, 200);
    assert.deepEqual(upsertedAlertKeys, [`evidence_gap:${STUDENT_ID}:req-ic3`]);
  });
});
