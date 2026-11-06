/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const CLASS_ID = "cclass0000000000000001";
const REGION_A = "cregion0000000000000001";
const REGION_B = "cregion0000000000000002";

type TestSession = { id: string; studentId: string; displayName: string; role: string };
let session: TestSession | null;

const classFindUnique = mock.fn() as any;
const classFindFirst = mock.fn() as any;
const classUpdate = mock.fn() as any;
const instructorFindMany = mock.fn() as any;
const regionInstructorFindMany = mock.fn() as any;
const regionFindUnique = mock.fn() as any;
const auditCreate = mock.fn() as any;

const tx = {
  spokesClass: { update: classUpdate },
  spokesClassInstructor: { deleteMany: mock.fn(), createMany: mock.fn() },
};

let PATCH: typeof import("./route").PATCH;

before(async () => {
  const realAuth = await import("@/lib/auth");
  mock.module("@/lib/auth", { exports: { ...realAuth, getSession: async () => session } });
  mock.module("@/lib/db", {
    namedExports: {
      prisma: {
        spokesClass: { findUnique: classFindUnique, findFirst: classFindFirst },
        spokesClassInstructor: { findMany: instructorFindMany },
        regionInstructor: { findMany: regionInstructorFindMany },
        region: { findUnique: regionFindUnique },
        student: { count: async () => 0 },
        $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
      },
      prismaAdmin: { auditLog: { create: auditCreate } },
    },
  });
  ({ PATCH } = await import("./route"));
});

function patch(body: unknown): Promise<Response> {
  const req = new Request("http://localhost/api/teacher/classes/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id: CLASS_ID }) });
}

beforeEach(() => {
  for (const fn of [classFindUnique, classFindFirst, classUpdate, instructorFindMany, regionInstructorFindMany, regionFindUnique, auditCreate]) {
    fn.mock.resetCalls();
  }
  session = { id: "cteacher000000000000001", studentId: "t", displayName: "T", role: "teacher" };
  classFindUnique.mock.mockImplementation(async () => ({
    id: CLASS_ID,
    name: "Morning",
    code: "morning",
    status: "active",
    instructors: [{ instructorId: "cteacher000000000000001" }],
  }));
  // assertStaffCanManageClass finds the class; the duplicate-code lookup finds none.
  classFindFirst.mock.mockImplementation(async (args: any) =>
    args?.where?.code ? null : { id: CLASS_ID, name: "Morning", code: "morning", status: "active" },
  );
  instructorFindMany.mock.mockImplementation(async () => []);
  regionInstructorFindMany.mock.mockImplementation(async () => [{ regionId: REGION_A }]);
  regionFindUnique.mock.mockImplementation(async () => ({ id: REGION_A, status: "active" }));
  classUpdate.mock.mockImplementation(async () => ({}));
  auditCreate.mock.mockImplementation(async () => ({}));
});

describe("PATCH /api/teacher/classes/[id] regionId", () => {
  it("refuses an instructor who sends regionId null, with 403 and no update", async () => {
    const res = await patch({ regionId: null });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "Only an admin can remove a classroom from its region.");
    assert.equal(classUpdate.mock.callCount(), 0);
  });

  it("lets an admin remove the region", async () => {
    session = { id: "cadmin0000000000000001", studentId: "a", displayName: "A", role: "admin" };
    const res = await patch({ regionId: null });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(classUpdate.mock.callCount(), 1);
    assert.equal(classUpdate.mock.calls[0].arguments[0].data.regionId, null);
  });

  it("lets an instructor move the class to their own region", async () => {
    const res = await patch({ regionId: REGION_A });
    assert.equal(res.status, 200);
    assert.equal(classUpdate.mock.calls[0].arguments[0].data.regionId, REGION_A);
  });

  it("refuses an instructor moving the class to a region that is not theirs", async () => {
    const res = await patch({ regionId: REGION_B });
    assert.equal(res.status, 403);
    assert.equal(classUpdate.mock.callCount(), 0);
  });

  it("leaves the region alone when regionId is absent", async () => {
    const res = await patch({ name: "Evening" });
    assert.equal(res.status, 200);
    assert.ok(!("regionId" in classUpdate.mock.calls[0].arguments[0].data));
  });

  it("answers 400 for a body that is not JSON-shaped as the schema expects", async () => {
    const res = await patch({ regionId: 12 });
    assert.equal(res.status, 400);
    assert.equal(classUpdate.mock.callCount(), 0);
  });
});
