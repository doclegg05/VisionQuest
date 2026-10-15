import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const STUDENT_ID = "student-1";
const CLASS_ID = "class-1";

interface CertRow {
  studentId: string;
  certType: string;
  status: string;
}

function certRequirement(itemId: string) {
  return {
    id: `req-${itemId}`,
    classId: CLASS_ID,
    itemType: "certification",
    itemId,
    title: itemId,
    status: "required",
    description: null,
    sortOrder: 0,
  };
}

const REQUIREMENTS = [
  certRequirement("ready-to-work"),
  certRequirement("workkeys-ncrc"),
  certRequirement("ic3"),
];

let certRows: CertRow[] = [];

mock.module("./db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: {
        findFirst: async () => ({ classId: CLASS_ID }),
        findMany: async () => [{ studentId: STUDENT_ID }],
      },
      classRequirement: { findMany: async () => REQUIREMENTS },
      certification: { findMany: async () => certRows },
      orientationProgress: { findMany: async () => [] },
      formSubmission: { findMany: async () => [] },
      progression: { findUnique: async () => null, findMany: async () => [] },
    },
  },
});

type Compliance = import("./class-requirement-compliance").StudentRequirementCompliance;

let checkers: Array<[string, () => Promise<Compliance | undefined>]>;

before(async () => {
  const mod = await import("./class-requirement-compliance");
  checkers = [
    ["checkStudentComplianceForClass", () => mod.checkStudentComplianceForClass(STUDENT_ID, CLASS_ID)],
    ["checkClassCompliance", async () => (await mod.checkClassCompliance(CLASS_ID)).get(STUDENT_ID)],
  ];
});

function metByItemId(compliance: Compliance | undefined) {
  assert.ok(compliance, "expected a compliance result for the student");
  return Object.fromEntries(compliance.items.map((item) => [item.itemId, item.met]));
}

describe("class requirement compliance: certification matching", () => {
  beforeEach(() => {
    certRows = [];
  });

  it("counts a completed legacy ready-to-work row toward Ready to Work family requirements only", async () => {
    certRows = [{ studentId: STUDENT_ID, certType: "ready-to-work", status: "completed" }];
    for (const [name, check] of checkers) {
      assert.deepEqual(
        metByItemId(await check()),
        { "ready-to-work": true, "workkeys-ncrc": true, ic3: false },
        name,
      );
    }
  });

  it("counts a completed workkeys-ncrc row toward a Ready to Work requirement", async () => {
    certRows = [{ studentId: STUDENT_ID, certType: "workkeys-ncrc", status: "completed" }];
    for (const [name, check] of checkers) {
      assert.deepEqual(
        metByItemId(await check()),
        { "ready-to-work": true, "workkeys-ncrc": true, ic3: false },
        name,
      );
    }
  });

  it("does not count an in-progress Ready to Work certification", async () => {
    certRows = [{ studentId: STUDENT_ID, certType: "ready-to-work", status: "in_progress" }];
    for (const [name, check] of checkers) {
      assert.deepEqual(
        metByItemId(await check()),
        { "ready-to-work": false, "workkeys-ncrc": false, ic3: false },
        name,
      );
    }
  });

  it("matches a catalog certification by its exact certType", async () => {
    certRows = [{ studentId: STUDENT_ID, certType: "ic3", status: "completed" }];
    for (const [name, check] of checkers) {
      assert.deepEqual(
        metByItemId(await check()),
        { "ready-to-work": false, "workkeys-ncrc": false, ic3: true },
        name,
      );
    }
  });
});
