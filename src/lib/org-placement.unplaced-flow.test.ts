/**
 * An admin places an instructor who has no region and no class.
 *
 * The route and `org-placement.ts` are the real code. Only the database, the
 * session and the audit writer are stood in. The database stand-in reads the
 * same `where` shapes the library sends, and throws on any shape it does not
 * know, so a changed query fails here instead of passing by accident.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

type Role = "teacher" | "student";
interface FakeStudent {
  id: string;
  role: Role;
  displayName: string;
  createdAt: Date;
}
interface FakeRegionInstructor {
  regionId: string;
  instructorId: string;
  assignedById: string | null;
}
type Where = Record<string, unknown>;

const INSTRUCTOR_ID = "ckinstructor0000000000000";
const STUDENT_ID = "ckstudent000000000000000";
const REGION_ID = "ckregion00000000000000000";
const OTHER_REGION_ID = "ckmissing00000000000000000";
const ADMIN = { id: "ckadmin0000000000000000", studentId: "a", displayName: "A", role: "admin" };

let session: { id: string; studentId: string; displayName: string; role: string } | null;
let students: FakeStudent[];
let regionInstructors: FakeRegionInstructor[];
let classInstructorIds: string[];
const knownRegionIds = [REGION_ID];
const audits: Array<Record<string, unknown>> = [];

function isEmptyNone(clause: unknown): boolean {
  return JSON.stringify(clause) === JSON.stringify({ none: {} });
}

/** Reads the where shapes `org-placement.ts` uses for an admin caller. */
function matches(student: FakeStudent, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "id") return student.id === value;
    if (key === "role") return student.role === value;
    if (key === "instructorRegions" && isEmptyNone(value)) {
      return !regionInstructors.some((row) => row.instructorId === student.id);
    }
    if (key === "instructedClasses" && isEmptyNone(value)) {
      return !classInstructorIds.includes(student.id);
    }
    throw new Error(`The test database does not know the where key "${key}".`);
  });
}

const prismaAdmin = {
  student: {
    findFirst: async (args: { where: Where }) => students.find((s) => matches(s, args.where)) ?? null,
    findMany: async (args: { where: Where }) => students.filter((s) => matches(s, args.where)),
  },
  regionInstructor: {
    upsert: async (args: { create: FakeRegionInstructor }) => {
      const exists = regionInstructors.some(
        (row) => row.regionId === args.create.regionId && row.instructorId === args.create.instructorId,
      );
      if (!exists) regionInstructors.push({ ...args.create });
      return args.create;
    },
  },
};
const prisma = {
  region: { count: async (args: { where: { id: string } }) => (knownRegionIds.includes(args.where.id) ? 1 : 0) },
};

let POST: typeof import("@/app/api/admin/org-placement/region-instructors/route").POST;
let lib: typeof import("./org-placement");

before(async () => {
  mock.module("@/lib/db", { namedExports: { prisma, prismaAdmin } });
  mock.module("@/lib/audit", {
    namedExports: {
      tryLogAuditEvent: async (input: Record<string, unknown>) => {
        audits.push(input);
        return { audited: true };
      },
    },
  });
  const realAuth = await import("@/lib/auth");
  mock.module("@/lib/auth", { exports: { ...realAuth, getSession: async () => session } });
  lib = await import("./org-placement");
  ({ POST } = await import("@/app/api/admin/org-placement/region-instructors/route"));
});

beforeEach(() => {
  session = ADMIN;
  students = [
    { id: INSTRUCTOR_ID, role: "teacher", displayName: "Tia Teacher", createdAt: new Date("2026-11-01T00:00:00Z") },
    { id: STUDENT_ID, role: "student", displayName: "Sam Student", createdAt: new Date("2026-11-02T00:00:00Z") },
  ];
  regionInstructors = [];
  classInstructorIds = [];
  audits.length = 0;
});

const place = (instructorId: string, regionId: string) =>
  POST(mockRequest("/api/admin/org-placement/region-instructors", { method: "POST", body: { instructorId, regionId } }));

describe("placing an unplaced instructor, from the panel's request to the library", () => {
  it("starts with an instructor who has no region and no class, listed for the admin", async () => {
    assert.equal(await lib.isUnplacedInstructor(INSTRUCTOR_ID), true);
    const listed = await lib.listUnplacedStaff(ADMIN);
    assert.deepEqual(listed.map((row) => row.id), [INSTRUCTOR_ID]);
  });

  it("places them in a region, records who did it, and leaves a count-only audit row", async () => {
    const res = await place(INSTRUCTOR_ID, REGION_ID);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, data: { assigned: true } });
    assert.deepEqual(regionInstructors, [{ regionId: REGION_ID, instructorId: INSTRUCTOR_ID, assignedById: ADMIN.id }]);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "org_placement.assign_region");
    assert.equal(audits[0].actorId, ADMIN.id);
    assert.equal(audits[0].targetId, INSTRUCTOR_ID);
    assert.deepEqual(audits[0].metadata, { regionId: REGION_ID });
  });

  it("leaves the unplaced state, so the notice goes away and the list empties", async () => {
    await place(INSTRUCTOR_ID, REGION_ID);
    assert.equal(await lib.isUnplacedInstructor(INSTRUCTOR_ID), false);
    assert.deepEqual(await lib.listUnplacedStaff(ADMIN), []);
  });

  it("answers a second press the same way and keeps one row", async () => {
    await place(INSTRUCTOR_ID, REGION_ID);
    const again = await place(INSTRUCTOR_ID, REGION_ID);
    assert.equal(again.status, 200);
    assert.equal(regionInstructors.length, 1);
  });

  it("does not let the instructor place themselves", async () => {
    session = { id: INSTRUCTOR_ID, studentId: "t", displayName: "Tia", role: "teacher" };
    const res = await place(INSTRUCTOR_ID, REGION_ID);
    assert.equal(res.status, 403);
    assert.equal(regionInstructors.length, 0);
    assert.equal(await lib.isUnplacedInstructor(INSTRUCTOR_ID), true);
  });

  it("refuses a region that does not exist, and writes nothing", async () => {
    const res = await place(INSTRUCTOR_ID, OTHER_REGION_ID);
    assert.equal(res.status, 403);
    assert.equal(regionInstructors.length, 0);
    assert.equal(audits.length, 0);
  });

  it("refuses an account that is not an instructor", async () => {
    const res = await place(STUDENT_ID, REGION_ID);
    assert.equal(res.status, 404);
    assert.equal(regionInstructors.length, 0);
  });
});

describe("the panel's control and the route agree", () => {
  it("posts the body keys and the path this route reads", async () => {
    const source = readFileSync(new URL("../components/staff/OrgPlacementPanel.tsx", import.meta.url), "utf8");
    const call = /api\.post\("([^"]+)",\s*\{\s*instructorId:[^,]+,\s*regionId,?\s*\}\)/.exec(source);
    assert.ok(call, "OrgPlacementPanel posts { instructorId, regionId }");
    assert.equal(call[1], "/api/admin/org-placement/region-instructors");
    const route = new URL("../app/api/admin/org-placement/region-instructors/route.ts", import.meta.url);
    assert.ok(readFileSync(route, "utf8").includes("export const POST"));
  });
});
