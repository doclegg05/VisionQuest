/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers signatures this route depends on. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

/**
 * POST /api/teacher/connect/connections (Match & Connect Task 4.3).
 *
 * Focused regression for the 2026-09 second-pass review finding: this route
 * returned `fields: packetFieldList(packet)` — the student-facing LABELS
 * ("Your résumé, written for this job") — while every other packet-bearing
 * payload (GET /api/connect/pending, the ConnectionsBoard row shape) returns
 * `fields: packet.includedFields`, the raw PACKET_FIELD_KEYS. The teacher
 * console (`(teacher)/teacher/connect/page.tsx`) maps `row.fields` through
 * `PACKET_FIELD_LABELS` itself — `row.fields.map((key) =>
 * PACKET_FIELD_LABELS[key])` — so a route that hands back labels instead of
 * keys would either double-translate into `undefined` or (if this route's
 * response reached that same mapping some other way) silently mismatch.
 * Nothing in this route's own client (ProposeConnectionButton.tsx) reads
 * `.fields` from the success response today, so this is a latent-consistency
 * fix, not a live break — pinned so it can't regress once something does.
 */

const session = mockTeacherSession();

const packet = {
  resumeVersionId: null,
  coverLetterId: null,
  resumeFileUploadId: null,
  endorsement: "Great work.",
  includedCertIds: [],
  includedFields: ["candidate_name", "resume", "endorsement"],
  candidateName: "Dana R.",
  certifications: [],
  availabilitySummary: "Weekdays",
  earliestStart: null,
  subsidyLine: null,
};

const mockListManagedStudentIds = mock.fn(async () => ["student-1"]) as any;
const mockIsConnectEnabledForStudent = mock.fn(async () => true) as any;
const mockLeadEmployerContext = mock.fn(async () => ({
  status: "active",
  subsidyFlags: null,
})) as any;
const mockProposeConnection = mock.fn(async () => ({ id: "conn-1", packet })) as any;
const mockRecordStudentView = mock.fn(async () => undefined) as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withTeacherAuth:
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

mock.module("@/lib/audit", {
  namedExports: { recordStudentView: mockRecordStudentView },
});

mock.module("@/lib/classroom", {
  namedExports: { listManagedStudentIds: mockListManagedStudentIds },
});

mock.module("@/lib/connect/connections", {
  namedExports: {
    ConnectionError: class ConnectionError extends Error {
      status: number;
      constructor(message: string, status: number) {
        super(message);
        this.status = status;
      }
    },
    leadEmployerContext: mockLeadEmployerContext,
    proposeConnection: mockProposeConnection,
  },
});

mock.module("@/lib/connect/flags", {
  namedExports: { isConnectEnabledForStudent: mockIsConnectEnabledForStudent },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

function postRequest() {
  return mockRequest("/api/teacher/connect/connections", {
    method: "POST",
    body: {
      studentId: "clh0000000000000000000001",
      jobLeadId: "clh0000000000000000000002",
    },
  });
}

describe("POST /api/teacher/connect/connections — response field shape (2026-09 second-pass review)", () => {
  beforeEach(() => {
    mockListManagedStudentIds.mock.resetCalls();
    mockIsConnectEnabledForStudent.mock.resetCalls();
    mockLeadEmployerContext.mock.resetCalls();
    mockProposeConnection.mock.resetCalls();
    mockRecordStudentView.mock.resetCalls();
    mockListManagedStudentIds.mock.mockImplementation(async () => ["student-1"]);
    mockIsConnectEnabledForStudent.mock.mockImplementation(async () => true);
    mockLeadEmployerContext.mock.mockImplementation(async () => ({
      status: "active",
      subsidyFlags: null,
    }));
    mockProposeConnection.mock.mockImplementation(async () => ({ id: "conn-1", packet }));
    mockRecordStudentView.mock.mockImplementation(async () => undefined);
  });

  it("returns fields as includedFields KEYS, not PACKET_FIELD_LABELS strings", async () => {
    const req = postRequest();
    // studentId in the fixture body doesn't match "student-1" exactly, so
    // point listManagedStudentIds at the id the route actually receives.
    mockListManagedStudentIds.mock.mockImplementation(async () => [
      "clh0000000000000000000001",
    ]);
    const res = await route.POST(req as never);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.data.fields, ["candidate_name", "resume", "endorsement"]);
    // The regression this pins: a label reads as prose with spaces and no
    // underscores — none of these keys should look like that.
    for (const field of body.data.fields as string[]) {
      assert.doesNotMatch(field, / /, `"${field}" looks like a label, not a PacketFieldKey`);
    }
  });
});
