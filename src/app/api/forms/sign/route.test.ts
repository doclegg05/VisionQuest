import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { studentLogKey } from "@/lib/log-keys";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

// Review finding F26 / API-U-01: the live "Signature submission failed." bug.
// The signature file and the FormSubmission row were saved, then
// syncStudentAlerts threw, and the catch-all turned that into a 500 the
// student read as "your signature did not save". The write is durable; the
// alert sync is best-effort and must never speak for the write.

// requiresSignature: true in src/lib/spokes/forms.ts
const FORM_ID = "attendance-contract";
const SIGNATURE = `data:image/png;base64,${Buffer.from("fake-png-bytes").toString("base64")}`;

const student = mockStudentSession();
let currentSession: Session | null = student;

const mockUploadFile = mock.fn<(key: string, buffer: Buffer, mimeType: string) => Promise<void>>();
const mockFileUploadCreate = mock.fn<
  (args: { data: Record<string, unknown> }) => Promise<{ id: string }>
>();
const mockFormSubmissionUpsert = mock.fn<
  (args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>
>();
const mockSyncStudentAlerts = mock.fn<(studentId: string) => Promise<void>>();
const mockWarn = mock.fn<(message: string, context?: Record<string, unknown>) => void>();
const mockError = mock.fn<(message: string, context?: Record<string, unknown>) => void>();

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => currentSession,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      fileUpload: { create: mockFileUploadCreate },
      formSubmission: { upsert: mockFormSubmissionUpsert },
    },
  },
});

mock.module("@/lib/storage", {
  namedExports: {
    uploadFile: mockUploadFile,
    generateStorageKey: (studentId: string, filename: string) => `${studentId}/${filename}`,
  },
});

mock.module("@/lib/advising", {
  namedExports: {
    syncStudentAlerts: mockSyncStudentAlerts,
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageStudent: async () => undefined,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: mockWarn,
      error: mockError,
    },
  },
});

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

function signRequest(body: unknown) {
  return mockRequest("/api/forms/sign", { method: "POST", body });
}

async function post(body: unknown) {
  return route.POST(signRequest(body) as never);
}

describe("POST /api/forms/sign", () => {
  beforeEach(() => {
    currentSession = student;
    mockUploadFile.mock.resetCalls();
    mockFileUploadCreate.mock.resetCalls();
    mockFormSubmissionUpsert.mock.resetCalls();
    mockSyncStudentAlerts.mock.resetCalls();
    mockWarn.mock.resetCalls();
    mockError.mock.resetCalls();

    mockUploadFile.mock.mockImplementation(async () => undefined);
    mockFileUploadCreate.mock.mockImplementation(async () => ({ id: "sig-file-1" }));
    mockFormSubmissionUpsert.mock.mockImplementation(async () => ({
      id: "submission-1",
      studentId: student.id,
      formId: FORM_ID,
      fileId: "sig-file-1",
      signatureFileId: "sig-file-1",
      status: "pending",
    }));
    mockSyncStudentAlerts.mock.mockImplementation(async () => undefined);
  });

  it("uploads the signature, saves the submission, then syncs alerts", async () => {
    const res = await post({ formId: FORM_ID, signature: SIGNATURE });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.submission.id, "submission-1");
    assert.equal(body.signatureFileId, "sig-file-1");

    assert.equal(mockUploadFile.mock.callCount(), 1);
    assert.equal(mockUploadFile.mock.calls[0].arguments[2], "image/png");
    assert.equal(mockFileUploadCreate.mock.calls[0].arguments[0].data.studentId, student.id);
    assert.equal(mockFileUploadCreate.mock.calls[0].arguments[0].data.category, "signature");
    assert.deepEqual(mockFormSubmissionUpsert.mock.calls[0].arguments[0].where, {
      studentId_formId: { studentId: student.id, formId: FORM_ID },
    });
    assert.equal(mockFormSubmissionUpsert.mock.calls[0].arguments[0].create.signatureFileId, "sig-file-1");
    assert.deepEqual(mockSyncStudentAlerts.mock.calls[0].arguments, [student.id]);
    assert.equal(mockWarn.mock.callCount(), 0);
    assert.equal(mockError.mock.callCount(), 0);
  });

  it("rejects a body with no signature before touching storage or the database", async () => {
    const res = await post({ formId: FORM_ID });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(typeof body.error, "string");
    assert.equal(mockUploadFile.mock.callCount(), 0);
    assert.equal(mockFileUploadCreate.mock.callCount(), 0);
    assert.equal(mockFormSubmissionUpsert.mock.callCount(), 0);
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);
  });

  it("rejects a signature that is not a PNG data URL", async () => {
    const res = await post({ formId: FORM_ID, signature: "data:image/jpeg;base64,AAAA" });

    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "Signature must be a PNG data URL.");
    assert.equal(mockUploadFile.mock.callCount(), 0);
    assert.equal(mockFormSubmissionUpsert.mock.callCount(), 0);
  });

  it("returns 401 with no session and writes nothing", async () => {
    currentSession = null;

    const res = await post({ formId: FORM_ID, signature: SIGNATURE });

    assert.equal(res.status, 401);
    assert.equal(mockUploadFile.mock.callCount(), 0);
    assert.equal(mockFileUploadCreate.mock.callCount(), 0);
    assert.equal(mockFormSubmissionUpsert.mock.callCount(), 0);
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);
  });

  it("still reports failure when the signature upload fails before the write", async () => {
    mockUploadFile.mock.mockImplementation(async () => {
      throw new Error("PutObject timed out");
    });

    const res = await post({ formId: FORM_ID, signature: SIGNATURE });

    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "Signature submission failed.");
    assert.equal(mockFileUploadCreate.mock.callCount(), 0);
    assert.equal(mockFormSubmissionUpsert.mock.callCount(), 0);
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);
  });

  it("still reports failure when the submission write itself fails", async () => {
    mockFormSubmissionUpsert.mock.mockImplementation(async () => {
      throw new Error("connection reset");
    });

    const res = await post({ formId: FORM_ID, signature: SIGNATURE });

    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "Signature submission failed.");
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);
  });

  it("reports success when the alert sync fails after the submission saved (live bug)", async () => {
    mockSyncStudentAlerts.mock.mockImplementation(async () => {
      throw new Error("advising sync timed out");
    });

    const res = await post({ formId: FORM_ID, signature: SIGNATURE });

    assert.equal(mockFormSubmissionUpsert.mock.callCount(), 1, "the submission was saved");
    assert.equal(
      res.status,
      200,
      "a saved signature must not be reported as failed because a later side effect threw",
    );
    const body = await res.json();
    assert.equal(body.submission.id, "submission-1");
    assert.equal(body.signatureFileId, "sig-file-1");

    assert.equal(mockWarn.mock.callCount(), 1, "the sync failure is logged, not surfaced");
    assert.equal(mockError.mock.callCount(), 0);
    const payload = mockWarn.mock.calls[0].arguments[1] ?? {};
    assert.equal(payload.surface, "forms/sign");
    assert.equal(payload.student, studentLogKey(student.id));
    const serialized = JSON.stringify(mockWarn.mock.calls[0].arguments);
    assert.ok(!serialized.includes(student.id), `log line leaked the student id: ${serialized}`);
  });
});
