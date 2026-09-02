/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// GrantKpiSnapshot is admin-only under RLS (grant_kpi_snapshot_admin_only)
// and its writer runs from the job processor with no session, so both the
// SpokesRecord roll-up and the snapshot row must go through the admin
// client (review F5, 2026-09-01). The app client is wired here only to
// prove it is never touched.
const appTouched = mock.fn() as any;
const adminRecordsFindManyMock = mock.fn() as any;
const adminSnapshotFindFirstMock = mock.fn() as any;
const adminSnapshotCreateMock = mock.fn() as any;
const adminSnapshotUpdateMock = mock.fn() as any;
const adminSnapshotFindManyMock = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      spokesRecord: { findMany: appTouched },
      grantKpiSnapshot: {
        findFirst: appTouched,
        create: appTouched,
        update: appTouched,
        findMany: appTouched,
      },
    },
    prismaAdmin: {
      spokesRecord: { findMany: adminRecordsFindManyMock },
      grantKpiSnapshot: {
        findFirst: adminSnapshotFindFirstMock,
        create: adminSnapshotCreateMock,
        update: adminSnapshotUpdateMock,
        findMany: adminSnapshotFindManyMock,
      },
    },
  },
});

mock.module("@/lib/classroom", {
  namedExports: { NON_ARCHIVED_ENROLLMENT_STATUSES: ["active", "inactive"] },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: mock.fn(), warn: mock.fn(), error: mock.fn() },
  },
});

let history: typeof import("./grant-kpi-history");
before(async () => {
  history = await import("./grant-kpi-history");
});

describe("grant-kpi-history", () => {
  beforeEach(() => {
    for (const fn of [
      appTouched,
      adminRecordsFindManyMock,
      adminSnapshotFindFirstMock,
      adminSnapshotCreateMock,
      adminSnapshotUpdateMock,
      adminSnapshotFindManyMock,
    ]) {
      fn.mock.resetCalls();
    }
    adminRecordsFindManyMock.mock.mockImplementation(async () => []);
    adminSnapshotFindFirstMock.mock.mockImplementation(async () => null);
    adminSnapshotCreateMock.mock.mockImplementation(async () => ({ id: "snap-1" }));
    adminSnapshotUpdateMock.mock.mockImplementation(async () => ({ id: "snap-1" }));
    adminSnapshotFindManyMock.mock.mockImplementation(async () => []);
  });

  it("takes the snapshot through the admin client only", async () => {
    await history.takeGrantKpiSnapshot();

    assert.equal(appTouched.mock.callCount(), 0, "app client would fail closed with no session");
    assert.equal(adminRecordsFindManyMock.mock.callCount(), 1);
    assert.equal(adminSnapshotCreateMock.mock.callCount(), 1);
    const data = adminSnapshotCreateMock.mock.calls[0].arguments[0].data;
    assert.match(data.programYear, /^PY\d{4}$/);
    assert.equal(data.classId, null);
    assert.equal(typeof JSON.parse(data.metrics), "object");
    assert.equal(typeof JSON.parse(data.counts), "object");
  });

  it("updates the day's existing snapshot instead of creating a second one", async () => {
    adminSnapshotFindFirstMock.mock.mockImplementation(async () => ({ id: "snap-existing" }));

    await history.takeGrantKpiSnapshot("class-1");

    assert.equal(adminSnapshotCreateMock.mock.callCount(), 0);
    assert.equal(adminSnapshotUpdateMock.mock.callCount(), 1);
    assert.equal(adminSnapshotUpdateMock.mock.calls[0].arguments[0].where.id, "snap-existing");
    assert.equal(appTouched.mock.callCount(), 0);
  });

  it("reads history through the admin client and parses the JSON columns", async () => {
    adminSnapshotFindManyMock.mock.mockImplementation(async () => [
      {
        snapshotDate: new Date("2026-09-01T00:00:00.000Z"),
        metrics: JSON.stringify({ enrollmentRate: 0.5 }),
        counts: JSON.stringify({ referred: 10 }),
      },
    ]);

    const rows = await history.getGrantKpiHistory("PY2026", "class-1");

    assert.equal(appTouched.mock.callCount(), 0, "teacher route reads an admin-only table; app client returns nothing");
    assert.equal(adminSnapshotFindManyMock.mock.callCount(), 1);
    const where = adminSnapshotFindManyMock.mock.calls[0].arguments[0].where;
    assert.deepEqual(where, { programYear: "PY2026", classId: "class-1" });
    assert.deepEqual(rows, [
      {
        snapshotDate: new Date("2026-09-01T00:00:00.000Z"),
        metrics: { enrollmentRate: 0.5 },
        counts: { referred: 10 },
      },
    ]);
  });
});
