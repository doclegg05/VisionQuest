import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const provisionIntakeStudentMock = mock.fn() as any;
mock.module("@/lib/intake/provision", {
  namedExports: {
    provisionIntakeStudent: provisionIntakeStudentMock,
  },
});

mock.module("@/lib/auth", {
  namedExports: {
    setSessionCookie: mock.fn(async () => "test-token"),
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: mock.fn(async () => ({ success: true, remaining: 14, reset: Date.now() + 60000 })),
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { error: mock.fn(), info: mock.fn() },
  },
});

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

describe("POST /api/intake/submit", () => {
  beforeEach(() => {
    provisionIntakeStudentMock.mock.resetCalls();
  });

  function createRequest(body: unknown) {
    return new Request("http://localhost:3000/api/intake/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as any;
  }

  it("rejects incomplete payload with 400", async () => {
    const req = createRequest({ firstName: "Marcus" }); // Missing lastName, county, birthDate
    const res = await route.POST(req);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.ok(json.error);
  });

  it("accepts valid intake payload and returns 201 with credentials", async () => {
    provisionIntakeStudentMock.mock.mockImplementation(async (data: any) => ({
      studentDbId: "db-student-555",
      studentId: "marcus.miller",
      displayName: `${data.firstName} ${data.lastName}`,
      isExisting: false,
      spokesRecordId: "spokes-rec-999",
      classId: "class-111",
      className: "Fayette County SPOKES",
      orientationInitialized: true,
      pdfStorageKey: "orientation/db-student-555/packet.pdf",
    }));

    const validPayload = {
      firstName: "Marcus",
      lastName: "Miller",
      birthDate: "1998-05-20",
      county: "Fayette",
      householdType: "Single parent (1P)",
      programTrack: "Healthcare / CNA",
      tanfStatus: true,
      ferpaConsentSigned: true,
      policyAcknowledgmentSigned: true,
      signatureName: "Marcus Miller",
    };

    const req = createRequest(validPayload);
    const res = await route.POST(req);
    assert.equal(res.status, 201);
    const json = await res.json();

    assert.equal(json.success, true);
    assert.equal(json.student.studentId, "marcus.miller");
    assert.equal(json.credentials.username, "marcus.miller");
    assert.ok(json.credentials.temporaryPassword.startsWith("Spokes"));
    assert.equal(json.enrollment.className, "Fayette County SPOKES");
    assert.equal(provisionIntakeStudentMock.mock.callCount(), 1);
  });
});
