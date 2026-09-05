/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@prisma/client";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

/**
 * PUT/GET /api/work-profile — the form fallback for the five-question intake
 * (Match & Connect Task 2.2). The route is student-only and always writes
 * session.id: a studentId in the payload is not "ignored", it is a 400, so a
 * client that tries it finds out rather than silently editing itself.
 */

const session = mockStudentSession();

const mockUpsert = mock.fn(async (args: any) => ({
  studentId: args.where.studentId,
  availability: args.create.availability ?? {},
  transport: args.update.transport ?? null,
  homeZip: args.update.homeZip ?? null,
  county: null,
  maxCommuteMinutes: null,
  payFloorHourly: args.update.payFloorHourly ?? null,
  childcareHours: null,
  earliestStart: args.update.earliestStart ?? null,
  shiftLimits: null,
  updatedAt: new Date("2026-09-05T00:00:00.000Z"),
  updatedVia: args.update.updatedVia ?? "student",
})) as any;
const mockFindUnique = mock.fn(async () => null) as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>) =>
      async (...args: Args) => {
        try {
          return await handler(session, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
    badRequest: (message: string) => makeHttpError(400, message),
    forbidden: (message: string) => makeHttpError(403, message),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentWorkProfile: {
        get upsert() {
          return mockUpsert;
        },
        get findUnique() {
          return mockFindUnique;
        },
      },
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

function fullGrid(value: boolean) {
  const slots = { morning: value, afternoon: value, evening: value, overnight: value };
  return {
    monday: { ...slots },
    tuesday: { ...slots },
    wednesday: { ...slots },
    thursday: { ...slots },
    friday: { ...slots },
    saturday: { ...slots },
    sunday: { ...slots },
  };
}

describe("PUT /api/work-profile", () => {
  beforeEach(() => {
    mockUpsert.mock.resetCalls();
    mockFindUnique.mock.resetCalls();
    mockFindUnique.mock.mockImplementation(async () => null);
  });

  it("saves the student's own answers as via=student", async () => {
    const res = await route.PUT(
      mockRequest("/api/work-profile", {
        method: "PUT",
        body: { transport: "bus", payFloorHourly: 15, homeZip: "25301" },
      }),
    );
    assert.equal(res.status, 200);
    assert.equal(mockUpsert.mock.callCount(), 1);
    const args = mockUpsert.mock.calls[0].arguments[0];
    assert.deepEqual(args.where, { studentId: session.id });
    assert.equal(args.update.updatedVia, "student");
    assert.equal(args.update.homeZip, "25301");
  });

  it("clears a nullable JSON column with Prisma.DbNull, not a bare null", async () => {
    // A bare `null` on a nullable Json column means the JSON literal null and
    // Prisma refuses it — so "delete my childcare note" was a broken write
    // while the payload was typed Record<string, unknown>. Typing the payload
    // is what surfaced it; this pins the behaviour.
    const res = await route.PUT(
      mockRequest("/api/work-profile", {
        method: "PUT",
        body: { childcareHours: null, shiftLimits: null },
      }),
    );
    assert.equal(res.status, 200);
    const args = mockUpsert.mock.calls[0].arguments[0];
    assert.equal(args.update.childcareHours, Prisma.DbNull);
    assert.equal(args.update.shiftLimits, Prisma.DbNull);
  });

  it("rejects a calendar date that does not exist", async () => {
    // "2026-09-31" used to store October 1 — a start date the student never
    // picked — and "2026-13-01" produced a 500 instead of a correctable 400.
    for (const bad of ["2026-09-31", "2026-02-30", "2026-13-01"]) {
      const res = await route.PUT(
        mockRequest("/api/work-profile", { method: "PUT", body: { earliestStart: bad } }),
      );
      assert.equal(res.status, 400, `${bad} should be refused`);
    }
    assert.equal(mockUpsert.mock.callCount(), 0);
  });

  it("rejects a payload carrying another student's id", async () => {
    const res = await route.PUT(
      mockRequest("/api/work-profile", {
        method: "PUT",
        body: { studentId: "stu-someone-else", payFloorHourly: 15 },
      }),
    );
    assert.equal(res.status, 400);
    assert.equal(mockUpsert.mock.callCount(), 0, "nothing may be written on a rejected payload");
  });

  it("rejects a payload trying to set updatedVia itself", async () => {
    const res = await route.PUT(
      mockRequest("/api/work-profile", { method: "PUT", body: { updatedVia: "teacher" } }),
    );
    assert.equal(res.status, 400);
    assert.equal(mockUpsert.mock.callCount(), 0);
  });

  it("rejects an invalid transport mode", async () => {
    const res = await route.PUT(
      mockRequest("/api/work-profile", { method: "PUT", body: { transport: "helicopter" } }),
    );
    assert.equal(res.status, 400);
    assert.equal(mockUpsert.mock.callCount(), 0);
  });

  it("accepts the full availability grid", async () => {
    const res = await route.PUT(
      mockRequest("/api/work-profile", { method: "PUT", body: { availability: fullGrid(true) } }),
    );
    assert.equal(res.status, 200);
    const args = mockUpsert.mock.calls[0].arguments[0];
    assert.equal(args.update.availability.monday.morning, true);
  });

  it("refuses a staff session rather than writing a work profile on a teacher row", async () => {
    const staff = { ...session, role: "teacher" };
    const original = { ...session };
    Object.assign(session, staff);
    try {
      const res = await route.PUT(
        mockRequest("/api/work-profile", { method: "PUT", body: { payFloorHourly: 15 } }),
      );
      assert.equal(res.status, 403);
      assert.equal(mockUpsert.mock.callCount(), 0);
    } finally {
      Object.assign(session, original);
    }
  });

  it("rejects a partial availability grid rather than dropping the missing days", async () => {
    const grid = fullGrid(true) as Record<string, unknown>;
    delete grid.sunday;
    const res = await route.PUT(
      mockRequest("/api/work-profile", { method: "PUT", body: { availability: grid } }),
    );
    assert.equal(res.status, 400);
    assert.equal(mockUpsert.mock.callCount(), 0);
  });
});

describe("GET /api/work-profile", () => {
  beforeEach(() => {
    mockUpsert.mock.resetCalls();
    mockFindUnique.mock.resetCalls();
  });

  it("returns a null profile before the student has answered anything", async () => {
    mockFindUnique.mock.mockImplementation(async () => null);
    const res = await route.GET();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.workProfile, null);
  });

  it("reads the caller's own row", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      studentId: session.id,
      availability: fullGrid(false),
      transport: "bus",
      homeZip: null,
      county: null,
      maxCommuteMinutes: null,
      payFloorHourly: 15,
      childcareHours: null,
      earliestStart: new Date("2026-10-01T00:00:00.000Z"),
      shiftLimits: null,
      updatedAt: new Date("2026-09-05T00:00:00.000Z"),
      updatedVia: "sage",
    }));

    const res = await route.GET();
    const body = await res.json();
    assert.deepEqual(mockFindUnique.mock.calls[0].arguments[0].where, { studentId: session.id });
    assert.equal(body.data.workProfile.transport, "bus");
    assert.equal(body.data.workProfile.earliestStart, "2026-10-01");
  });
});
