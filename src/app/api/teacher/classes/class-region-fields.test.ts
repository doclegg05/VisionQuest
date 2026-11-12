/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";

// Both class routes return each class's region, and the PATCH audit row
// records a region move. This file sits outside the [id] folder because
// `node --test` reads a bracketed folder in a path as a glob.

const CLASS_ID = "cclass0000000000000001";
const REGION_A = "cregion0000000000000001";
const REGION_B = "cregion0000000000000002";
const ADMIN = { id: "cadmin0000000000000001", studentId: "a", displayName: "A", role: "admin" };

const classFindMany = mock.fn() as any;
const classFindUnique = mock.fn() as any;
const classFindFirst = mock.fn(async () => null) as any;
const classUpdate = mock.fn(async () => ({})) as any;
const audit = mock.fn(async () => undefined) as any;

const tx = {
  spokesClass: { update: classUpdate },
  spokesClassInstructor: { deleteMany: mock.fn(), createMany: mock.fn() },
};

let listRoute: typeof import("./route");
let classRoute: typeof import("./[id]/route");

before(async () => {
  const realAuth = await import("@/lib/auth");
  mock.module("@/lib/auth", { exports: { ...realAuth, getSession: async () => ADMIN } });
  mock.module("@/lib/registry/middleware", {
    exports: {
      withRegistry: (_tool: string, handler: (...args: any[]) => Promise<Response>) => async (req: Request, ctx: unknown) =>
        handler(ADMIN, req, ctx, { id: "classes.list" }),
    },
  });
  mock.module("@/lib/classroom", {
    exports: {
      assertStaffCanManageClass: async () => undefined,
      assertTeacherAssignmentLimit: async () => undefined,
      listManagedClasses: async () => [{ id: CLASS_ID }],
      normalizeClassCode: (value: string) => value,
      normalizeInstructorIds: (ids: string[]) => ids,
    },
  });
  mock.module("@/lib/class-create", {
    exports: { assertRegionAllowed: async () => undefined, createClassWithInstructors: async () => ({}) },
  });
  mock.module("@/lib/region", {
    exports: {
      countInstructorsInRegion: async () => 0,
      listRegionsForClassCreation: async () => [{ id: REGION_A, name: "North", code: "north", status: "active" }],
    },
  });
  mock.module("@/lib/audit", { exports: { logAuditEvent: audit } });
  mock.module("@/lib/db", {
    exports: {
      prisma: {
        spokesClass: { findMany: classFindMany, findUnique: classFindUnique, findFirst: classFindFirst },
        student: { findMany: async () => [], count: async (args: any) => (args?.where?.id?.in ?? []).length },
        $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
      },
      prismaAdmin: {},
    },
  });
  listRoute = await import("./route");
  classRoute = await import("./[id]/route");
});

const classRow = {
  id: CLASS_ID,
  name: "Morning",
  code: "morning",
  status: "active",
  programType: "spokes",
  description: null,
  startDate: null,
  endDate: null,
  regionId: REGION_A,
  region: { id: REGION_A, name: "North" },
  instructors: [],
  enrollments: [],
};

beforeEach(() => {
  for (const fn of [classFindMany, classFindUnique, classUpdate, audit]) fn.mock.resetCalls();
  classFindMany.mock.mockImplementation(async () => [classRow]);
  classFindUnique.mock.mockImplementation(async () => ({ ...classRow, instructors: [] }));
});

function selectOf(fn: any): any {
  return fn.mock.calls[0].arguments[0].select;
}

describe("GET /api/teacher/classes", () => {
  it("asks for each class's region id and name, and nothing else about the region", async () => {
    const res = await listRoute.GET(new NextRequest("http://localhost/api/teacher/classes"), { params: Promise.resolve({}) });
    assert.equal(res.status, 200);
    const select = selectOf(classFindMany);
    assert.equal(select.regionId, true);
    assert.deepEqual(select.region, { select: { id: true, name: true } });
    const body = await res.json();
    assert.equal(body.classes[0].regionId, REGION_A);
    assert.deepEqual(body.classes[0].region, { id: REGION_A, name: "North" });
  });
});

describe("GET /api/teacher/classes/[id]", () => {
  it("returns the class's region id and name", async () => {
    const res = await classRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: CLASS_ID }) });
    assert.equal(res.status, 200);
    const select = selectOf(classFindUnique);
    assert.equal(select.regionId, true);
    assert.deepEqual(select.region, { select: { id: true, name: true } });
    const body = await res.json();
    assert.equal(body.class.regionId, REGION_A);
    assert.deepEqual(body.class.region, { id: REGION_A, name: "North" });
  });
});

function patch(body: unknown): Promise<Response> {
  const req = new Request("http://localhost/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return classRoute.PATCH(req, { params: Promise.resolve({ id: CLASS_ID }) });
}

describe("PATCH /api/teacher/classes/[id] audit row", () => {
  it("records the region a class moved from and to", async () => {
    const res = await patch({ regionId: REGION_B });
    assert.equal(res.status, 200);
    const metadata = audit.mock.calls[0].arguments[0].metadata;
    assert.equal(metadata.previousRegionId, REGION_A);
    assert.equal(metadata.regionId, REGION_B);
  });

  it("records the same region twice when the class did not move", async () => {
    await patch({ name: "Evening" });
    const metadata = audit.mock.calls[0].arguments[0].metadata;
    assert.equal(metadata.previousRegionId, REGION_A);
    assert.equal(metadata.regionId, REGION_A);
  });
});
