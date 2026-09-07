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
const mockFileUploadFindFirst = mock.fn<
  (args: { where: Record<string, unknown> }) => Promise<{ id: string } | null>
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
      fileUpload: { create: mockFileUploadCreate, findFirst: mockFileUploadFindFirst },
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
    mockFileUploadFindFirst.mock.resetCalls();
    mockFormSubmissionUpsert.mock.resetCalls();
    mockSyncStudentAlerts.mock.resetCalls();
    mockWarn.mock.resetCalls();
    mockError.mock.resetCalls();

    mockUploadFile.mock.mockImplementation(async () => undefined);
    mockFileUploadCreate.mock.mockImplementation(async () => ({ id: "sig-file-1" }));
    mockFileUploadFindFirst.mock.mockImplementation(async () => ({ id: "own-file-1" }));
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

  // `fileId` names the FILE a signed submission points at, and the teacher's
  // forms view and student-detail page render it without re-scoping. Every
  // sibling route scopes its file lookup to the student (portfolio,
  // certifications, vision-board, applications); this one validated the id as
  // a cuid and nothing more, so a student could attach another student's
  // upload as their own signed form and staff would download the victim's file
  // labelled as this student's signature.
  it("refuses a fileId that does not belong to the target student", async () => {
    mockFileUploadFindFirst.mock.mockImplementation(async () => null);

    const res = await post({
      formId: FORM_ID,
      signature: SIGNATURE,
      fileId: "cm00000000000000000000000",
    });

    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "Attached file was not found.");
    assert.equal(
      mockFormSubmissionUpsert.mock.callCount(),
      0,
      "a foreign fileId must never reach the submission write",
    );
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);

    // Scoped by owner, not merely by id.
    const where = mockFileUploadFindFirst.mock.calls[0].arguments[0].where;
    assert.deepEqual(where, { id: "cm00000000000000000000000", studentId: student.id });
  });

  it("accepts a fileId the target student owns and writes it to the submission", async () => {
    mockFileUploadFindFirst.mock.mockImplementation(async () => ({ id: "own-file-1" }));

    const res = await post({
      formId: FORM_ID,
      signature: SIGNATURE,
      fileId: "cm11111111111111111111111",
    });

    assert.equal(res.status, 200);
    assert.equal(mockFormSubmissionUpsert.mock.callCount(), 1);
    const args = mockFormSubmissionUpsert.mock.calls[0].arguments[0];
    assert.equal(args.create.fileId, "cm11111111111111111111111");
    assert.equal(args.update.fileId, "cm11111111111111111111111");
  });

  it("does not look up a file when no fileId was supplied", async () => {
    const res = await post({ formId: FORM_ID, signature: SIGNATURE });

    assert.equal(res.status, 200);
    assert.equal(mockFileUploadFindFirst.mock.callCount(), 0);
    // The signature file stands in as the submission's file, as before.
    assert.equal(mockFormSubmissionUpsert.mock.calls[0].arguments[0].create.fileId, "sig-file-1");
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

    // The sync now runs off the response path; let its rejection settle.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(mockWarn.mock.callCount(), 1, "the sync failure is logged, not surfaced");
    assert.equal(mockError.mock.callCount(), 0);
    const payload = mockWarn.mock.calls[0].arguments[1] ?? {};
    assert.equal(payload.surface, "forms/sign");
    assert.equal(payload.student, studentLogKey(student.id));
    const serialized = JSON.stringify(mockWarn.mock.calls[0].arguments);
    assert.ok(!serialized.includes(student.id), `log line leaked the student id: ${serialized}`);
  });

  // Prod, 2026-09-07: the route awaited syncStudentAlerts before answering,
  // so one student's "Submitting..." sat for ~45 s while the alert sync ran
  // (and re-ran, once per extra tap). The signature had saved in under a
  // second. A sync that never resolves must not hold the response.
  it("answers as soon as the submission is saved, without waiting for the alert sync", async () => {
    let releaseSync: () => void = () => undefined;
    mockSyncStudentAlerts.mock.mockImplementation(
      () => new Promise<void>((resolve) => {
        releaseSync = resolve;
      }),
    );

    const timeout = new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), 500));
    const outcome = await Promise.race([post({ formId: FORM_ID, signature: SIGNATURE }), timeout]);

    assert.notEqual(outcome, "timed out", "the response waited on the alert sync");
    const res = outcome as Response;
    assert.equal(res.status, 200);
    assert.equal(mockFormSubmissionUpsert.mock.callCount(), 1, "the submission was saved first");
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 1, "the sync is still started");
    assert.deepEqual(mockSyncStudentAlerts.mock.calls[0].arguments, [student.id]);

    releaseSync();
  });
});
