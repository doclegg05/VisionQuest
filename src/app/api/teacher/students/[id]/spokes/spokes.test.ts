/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

const session = mockTeacherSession();

const STUDENT_ID = "student-1";
const APPLICATION_ID = "clapp1234567890abcdefghij";
const OTHER_APPLICATION_ID = "clother234567890abcdefghi";

const mockGetSession = mock.fn() as any;
const mockAssertStaffCanManageStudent = mock.fn() as any;
const mockEnsureSpokesRecordForStudent = mock.fn() as any;
const mockBuildSpokesSummary = mock.fn() as any;
const mockApplicationFindFirst = mock.fn() as any;
const mockSpokesRecordUpdate = mock.fn() as any;
const mockSyncStudentAlerts = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

// api-error is left REAL: withTeacherAuth's error handler is part of what
// these tests exercise (a rethrown P2002 must surface as a 500, not a 409).
// Only its getSession dependency is stubbed; rls-context is pure
// AsyncLocalStorage and needs no mock.
mock.module("@/lib/auth", {
  namedExports: {
    getSession: mockGetSession,
  },
});

// "server-only" (pulled in by placement-bridge) throws outside a Next.js
// server build; system-config would pull prismaAdmin.
mock.module("server-only", { namedExports: {} });
mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: mock.fn(async () => null),
    setPlainConfigValue: mock.fn(async () => undefined),
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageStudent: mockAssertStaffCanManageStudent,
  },
});

mock.module("@/lib/spokes", {
  namedExports: {
    buildSpokesSummary: mockBuildSpokesSummary,
    ensureSpokesRecordForStudent: mockEnsureSpokesRecordForStudent,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      application: {
        findFirst: mockApplicationFindFirst,
      },
      spokesRecord: {
        update: mockSpokesRecordUpdate,
      },
    },
  },
});

mock.module("@/lib/advising", {
  namedExports: {
    syncStudentAlerts: mockSyncStudentAlerts,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

function existingRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "spokes-1",
    studentId: STUDENT_ID,
    firstName: "Test",
    lastName: "Student",
    referralEmail: null,
    county: null,
    householdType: null,
    requiredParticipationHours: null,
    status: "enrolled",
    gender: null,
    race: null,
    ethnicity: null,
    educationalLevel: null,
    postSecondaryProgram: null,
    unsubsidizedEmploymentAt: null,
    employerName: null,
    nonCompleterReason: null,
    notes: null,
    placementApplicationId: null,
    ...overrides,
  };
}

function qualifyingApplication() {
  return {
    id: APPLICATION_ID,
    studentId: STUDENT_ID,
    status: "accepted",
    verificationStatus: "verified",
    verifiedAt: new Date("2026-07-29T12:00:00Z"),
    opportunity: { title: "Line Cook", company: "Mountain Diner" },
  };
}

function putSpokes(body: Record<string, unknown>) {
  const req = mockRequest(`/api/teacher/students/${STUDENT_ID}/spokes`, {
    method: "PUT",
    body,
  });
  return route.PUT(req as never, {
    params: Promise.resolve({ id: STUDENT_ID }),
  } as never);
}

function updatedPlacementId(): string | null {
  return mockSpokesRecordUpdate.mock.calls[0]?.arguments[0].data.placementApplicationId;
}

describe("PUT /api/teacher/students/[id]/spokes", () => {
  beforeEach(() => {
    mockGetSession.mock.resetCalls();
    mockAssertStaffCanManageStudent.mock.resetCalls();
    mockEnsureSpokesRecordForStudent.mock.resetCalls();
    mockApplicationFindFirst.mock.resetCalls();
    mockSpokesRecordUpdate.mock.resetCalls();
    mockSyncStudentAlerts.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();

    mockGetSession.mock.mockImplementation(async () => session);
    mockAssertStaffCanManageStudent.mock.mockImplementation(async () => undefined);
    mockEnsureSpokesRecordForStudent.mock.mockImplementation(async () => existingRecord());
    mockApplicationFindFirst.mock.mockImplementation(async () => qualifyingApplication());
    mockSpokesRecordUpdate.mock.mockImplementation(async (args: any) => ({
      ...existingRecord(),
      ...args.data,
    }));
    mockSyncStudentAlerts.mock.mockImplementation(async () => undefined);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
  });

  it("rejects a malformed placementApplicationId with a Zod 400", async () => {
    const res = await putSpokes({ placementApplicationId: "not-a-cuid" });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Invalid application ID.");
    assert.equal(mockSpokesRecordUpdate.mock.calls.length, 0);
  });

  it("sets the link when a cuid arrives, via a student-scoped lookup", async () => {
    const res = await putSpokes({
      placementApplicationId: APPLICATION_ID,
      unsubsidizedEmploymentAt: "2026-07-15",
    });

    assert.equal(res.status, 200);
    // Existence oracle guard: the query itself must be scoped to the student.
    assert.deepEqual(mockApplicationFindFirst.mock.calls[0]?.arguments[0].where, {
      id: APPLICATION_ID,
      studentId: STUDENT_ID,
    });
    assert.equal(updatedPlacementId(), APPLICATION_ID);
  });

  it("returns one plain 404 when the scoped lookup misses (absent or foreign id)", async () => {
    mockApplicationFindFirst.mock.mockImplementation(async () => null);

    const res = await putSpokes({
      placementApplicationId: OTHER_APPLICATION_ID,
      unsubsidizedEmploymentAt: "2026-07-15",
    });

    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Application not found.");
    assert.equal(mockSpokesRecordUpdate.mock.calls.length, 0);
  });

  it("carries an existing link forward when the field is absent", async () => {
    mockEnsureSpokesRecordForStudent.mock.mockImplementation(async () =>
      existingRecord({ placementApplicationId: APPLICATION_ID }),
    );

    const res = await putSpokes({ unsubsidizedEmploymentAt: "2026-07-15" });

    assert.equal(res.status, 200);
    assert.equal(mockApplicationFindFirst.mock.calls.length, 0);
    assert.equal(updatedPlacementId(), APPLICATION_ID);
  });

  it("clears the link when null arrives, even without an employment date", async () => {
    mockEnsureSpokesRecordForStudent.mock.mockImplementation(async () =>
      existingRecord({ placementApplicationId: APPLICATION_ID }),
    );

    const res = await putSpokes({ placementApplicationId: null });

    assert.equal(res.status, 200);
    assert.equal(mockApplicationFindFirst.mock.calls.length, 0);
    assert.equal(updatedPlacementId(), null);
  });

  it("refuses a resulting state with a link but no employment date", async () => {
    mockEnsureSpokesRecordForStudent.mock.mockImplementation(async () =>
      existingRecord({
        placementApplicationId: APPLICATION_ID,
        unsubsidizedEmploymentAt: new Date("2026-07-15"),
      }),
    );

    // Carries the link forward implicitly while blanking the date.
    const res = await putSpokes({ unsubsidizedEmploymentAt: "" });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /start date/);
    assert.equal(mockSpokesRecordUpdate.mock.calls.length, 0);
  });

  it("maps a P2002 on placementApplicationId to a 409", async () => {
    mockSpokesRecordUpdate.mock.mockImplementation(async () => {
      throw Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["placementApplicationId"] },
      });
    });

    const res = await putSpokes({
      placementApplicationId: APPLICATION_ID,
      unsubsidizedEmploymentAt: "2026-07-15",
    });

    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /already linked to another placement record/);
  });

  it("rethrows a P2002 on a different unique column (studentId) as a 500", async () => {
    mockSpokesRecordUpdate.mock.mockImplementation(async () => {
      throw Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["studentId"] },
      });
    });

    const res = await putSpokes({ unsubsidizedEmploymentAt: "2026-07-15" });

    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Internal server error");
  });
});
