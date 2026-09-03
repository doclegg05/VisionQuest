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
    getSession: mock.fn(async () => null),
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

describe("POST /api/intake/webhook", () => {
  // Dummy value for this test only — never a real credential. gitleaks:allow
  const validSecret = "test-fixture-not-a-real-secret";

  beforeEach(() => {
    process.env.INTAKE_WEBHOOK_SECRET = validSecret;
    provisionIntakeStudentMock.mock.resetCalls();
  });

  function createRequest(options: { auth?: string; body?: unknown }) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options.auth) {
      headers.authorization = options.auth;
    }

    return new Request("http://localhost:3000/api/intake/webhook", {
      method: "POST",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : "{}",
    });
  }

  it("rejects unauthorized request with 401 when no auth header provided", async () => {
    const req = createRequest({ body: {} });
    const res = await route.POST(req);
    assert.equal(res.status, 401);
  });

  it("rejects unauthorized request with 401 when invalid secret is provided", async () => {
    const req = createRequest({ auth: "Bearer wrong-secret", body: {} });
    const res = await route.POST(req);
    assert.equal(res.status, 401);
  });

  it("rejects invalid payload with 400 when required fields are missing", async () => {
    const req = createRequest({
      auth: `Bearer ${validSecret}`,
      body: { firstName: "Jane" }, // Missing lastName, county, birthDate
    });
    const res = await route.POST(req);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, "Validation failed.");
    assert.ok(Array.isArray(json.details));
  });

  it("accepts valid intake payload with valid secret and returns 201 Created", async () => {
    provisionIntakeStudentMock.mock.mockImplementation(async (data: any) => ({
      studentDbId: "db-student-123",
      studentId: "marcus.miller",
      displayName: `${data.firstName} ${data.lastName}`,
      isExisting: false,
      spokesRecordId: "spokes-rec-456",
      classId: "class-789",
      className: "Fayette County SPOKES",
      orientationInitialized: true,
      pdfStorageKey: "orientation/db-student-123/packet.pdf",
    }));

    const validPayload = {
      firstName: "Marcus",
      lastName: "Miller",
      email: "marcus.miller@example.com",
      birthDate: "1998-05-20",
      county: "Fayette",
      householdType: "Single parent (1P)",
      programTrack: "Healthcare / CNA",
      tanfStatus: true,
      ferpaConsentSigned: true,
      policyAcknowledgmentSigned: true,
      signatureName: "Marcus Miller",
    };

    const req = createRequest({
      auth: `Bearer ${validSecret}`,
      body: validPayload,
    });

    const res = await route.POST(req);
    assert.equal(res.status, 201);
    const json = await res.json();

    assert.equal(json.success, true);
    assert.equal(json.student.studentId, "marcus.miller");
    assert.equal(json.student.displayName, "Marcus Miller");
    assert.equal(json.enrollment.className, "Fayette County SPOKES");
    assert.equal(json.orientation.initialized, true);
    assert.equal(json.orientation.packetStorageKey, "orientation/db-student-123/packet.pdf");
    assert.equal(provisionIntakeStudentMock.mock.callCount(), 1);
  });
});
