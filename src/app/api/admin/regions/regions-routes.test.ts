/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// The four admin region routes. This file sits outside the bracketed folders
// because `node --test` reads a bracketed folder in a path as a glob.

const REGION_ID = "cregion0000000000000001";
const PERSON_ID = "cperson0000000000000001";
const ADMIN = { id: "cadmin0000000000000001", studentId: "a", displayName: "A", role: "admin" };

const regionFindUnique = mock.fn() as any;
const regionCreate = mock.fn() as any;
const regionUpdate = mock.fn() as any;
const studentFindUnique = mock.fn() as any;
const assignmentFindUnique = mock.fn() as any;
const assignmentCreate = mock.fn() as any;
const assignmentDelete = mock.fn() as any;
const audit = mock.fn(async () => undefined) as any;

let createRoute: typeof import("./route");
let regionRoute: typeof import("./[id]/route");
let assignRoute: typeof import("./[id]/coordinators/route");
let removeRoute: typeof import("./[id]/coordinators/[coordinatorId]/route");

before(async () => {
  const realAuth = await import("@/lib/auth");
  mock.module("@/lib/auth", { exports: { ...realAuth, getSession: async () => ADMIN } });
  mock.module("@/lib/audit", { exports: { logAuditEvent: audit } });
  mock.module("@/lib/db", {
    exports: {
      prisma: {
        region: { findUnique: regionFindUnique, create: regionCreate, update: regionUpdate },
        student: { findUnique: studentFindUnique },
        regionCoordinator: { findUnique: assignmentFindUnique, create: assignmentCreate, delete: assignmentDelete },
      },
      prismaAdmin: {},
    },
  });
  createRoute = await import("./route");
  regionRoute = await import("./[id]/route");
  assignRoute = await import("./[id]/coordinators/route");
  removeRoute = await import("./[id]/coordinators/[coordinatorId]/route");
});

const stamp = new Date("2026-11-10T00:00:00.000Z");
const regionRow = { id: REGION_ID, name: "North", code: "north", description: null, status: "active", createdAt: stamp, updatedAt: stamp };

beforeEach(() => {
  for (const fn of [regionFindUnique, regionCreate, regionUpdate, studentFindUnique, assignmentFindUnique, assignmentCreate, assignmentDelete, audit]) {
    fn.mock.resetCalls();
  }
  // By code: no clash. By id: the region exists and is active.
  regionFindUnique.mock.mockImplementation(async (args: any) => (args.where.code ? null : { id: REGION_ID, status: "active" }));
  regionCreate.mock.mockImplementation(async (args: any) => ({ ...regionRow, ...args.data }));
  regionUpdate.mock.mockImplementation(async (args: any) => ({ ...regionRow, ...args.data }));
  studentFindUnique.mock.mockImplementation(async () => ({ id: PERSON_ID, role: "coordinator", isActive: true }));
  assignmentFindUnique.mock.mockImplementation(async (args: any) => (args.select ? null : null));
  assignmentCreate.mock.mockImplementation(async () => ({ regionId: REGION_ID, coordinatorId: PERSON_ID, assignedAt: stamp }));
  assignmentDelete.mock.mockImplementation(async () => ({}));
});

function json(method: string, body: unknown): Request {
  return new Request("http://localhost/api/admin/regions", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function auditRow(): any {
  assert.equal(audit.mock.callCount(), 1, "one audit row per change");
  return audit.mock.calls[0].arguments[0];
}

/** Ids only: no region or person name anywhere in the row. */
function assertNoNames(row: any): void {
  assert.doesNotMatch(JSON.stringify(row), /North|Pat Lee/);
}

describe("POST /api/admin/regions", () => {
  const create = (body: unknown) => createRoute.POST(json("POST", body));

  it("refuses a name of only spaces", async () => {
    const res = await create({ name: "   ", code: "north" });
    assert.equal(res.status, 400);
    assert.equal(regionCreate.mock.callCount(), 0);
  });

  it("refuses a name with a line break or a control character", async () => {
    for (const name of ["North\nRegion", "North\tRegion", "North\u0007"]) {
      const res = await create({ name, code: "north" });
      assert.equal(res.status, 400, JSON.stringify(name));
    }
    assert.equal(regionCreate.mock.callCount(), 0);
  });

  it("stores the trimmed name and writes one audit row with ids only", async () => {
    const res = await create({ name: "  North  ", code: "North" });
    assert.equal(res.status, 201);
    assert.equal(regionCreate.mock.calls[0].arguments[0].data.name, "North");
    const row = auditRow();
    assert.equal(row.action, "admin.region.create");
    assert.equal(row.targetType, "region");
    assert.equal(row.targetId, REGION_ID);
    assert.equal(row.actorId, ADMIN.id);
    assertNoNames(row);
  });
});

describe("PATCH /api/admin/regions/[id]", () => {
  const update = (id: string, body: unknown) => regionRoute.PATCH(json("PATCH", body), { params: Promise.resolve({ id }) });

  it("refuses an id that is not a cuid, before any lookup", async () => {
    const res = await update("not a cuid", { name: "East" });
    assert.equal(res.status, 400);
    assert.equal(regionFindUnique.mock.callCount(), 0);
  });

  it("refuses a name of only spaces, or with a line break", async () => {
    assert.equal((await update(REGION_ID, { name: "  " })).status, 400);
    assert.equal((await update(REGION_ID, { name: "East\r\nWest" })).status, 400);
    assert.equal(regionUpdate.mock.callCount(), 0);
  });

  it("writes one audit row naming the fields changed, not their values", async () => {
    const res = await update(REGION_ID, { name: "North" });
    assert.equal(res.status, 200);
    const row = auditRow();
    assert.equal(row.action, "admin.region.update");
    assert.equal(row.targetId, REGION_ID);
    assert.deepEqual(row.metadata, { fields: ["name"] });
    assertNoNames(row);
  });
});

describe("POST /api/admin/regions/[id]/coordinators", () => {
  const assign = (id: string, body: unknown) => assignRoute.POST(json("POST", body), { params: Promise.resolve({ id }) });

  it("refuses a region id or a coordinator id that is not a cuid", async () => {
    assert.equal((await assign("bad id", { coordinatorId: PERSON_ID })).status, 400);
    assert.equal((await assign(REGION_ID, { coordinatorId: "bad id" })).status, 400);
    assert.equal(assignmentCreate.mock.callCount(), 0);
  });

  it("refuses an archived region", async () => {
    regionFindUnique.mock.mockImplementation(async () => ({ id: REGION_ID, status: "archived" }));
    const res = await assign(REGION_ID, { coordinatorId: PERSON_ID });
    assert.equal(res.status, 409);
    assert.equal(assignmentCreate.mock.callCount(), 0);
  });

  it("refuses an account that is not active", async () => {
    studentFindUnique.mock.mockImplementation(async () => ({ id: PERSON_ID, role: "coordinator", isActive: false }));
    const res = await assign(REGION_ID, { coordinatorId: PERSON_ID });
    assert.equal(res.status, 400);
    assert.equal(assignmentCreate.mock.callCount(), 0);
  });

  it("assigns an admin as well as a regional coordinator", async () => {
    studentFindUnique.mock.mockImplementation(async () => ({ id: PERSON_ID, role: "admin", isActive: true }));
    assert.equal((await assign(REGION_ID, { coordinatorId: PERSON_ID })).status, 201);
  });

  it("writes one audit row with the two ids", async () => {
    await assign(REGION_ID, { coordinatorId: PERSON_ID });
    const row = auditRow();
    assert.equal(row.action, "admin.region.coordinator.assign");
    assert.equal(row.targetId, REGION_ID);
    assert.deepEqual(row.metadata, { coordinatorId: PERSON_ID });
    assertNoNames(row);
  });
});

describe("DELETE /api/admin/regions/[id]/coordinators/[coordinatorId]", () => {
  const remove = (id: string, coordinatorId: string) =>
    removeRoute.DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id, coordinatorId }) });

  it("refuses ids that are not cuids, before any lookup", async () => {
    assert.equal((await remove("bad id", PERSON_ID)).status, 400);
    assert.equal((await remove(REGION_ID, "bad id")).status, 400);
    assert.equal(assignmentFindUnique.mock.callCount(), 0);
  });

  it("writes one audit row with the two ids", async () => {
    assignmentFindUnique.mock.mockImplementation(async () => ({ regionId: REGION_ID }));
    const res = await remove(REGION_ID, PERSON_ID);
    assert.equal(res.status, 200);
    const row = auditRow();
    assert.equal(row.action, "admin.region.coordinator.remove");
    assert.equal(row.targetId, REGION_ID);
    assert.deepEqual(row.metadata, { coordinatorId: PERSON_ID });
  });
});
