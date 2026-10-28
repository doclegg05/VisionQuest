import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";

const SESSION: Session = {
  id: "teacher-1",
  studentId: "",
  role: "teacher",
  displayName: "Dana Reeves",
};

class ApiError extends Error {
  constructor(readonly statusCode: number, message: string, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

// withTeacherAuth wraps withErrorHandler in production, which turns a thrown
// ApiError into its status. Keep that here so parseBody rejections surface as
// 400s rather than escaping the handler.
mock.module("@/lib/api-error", {
  namedExports: {
    ApiError,
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
    badRequest: (msg: string) => new ApiError(400, msg, "BAD_REQUEST"),
    unauthorized: (msg = "Unauthorized") => new ApiError(401, msg, "UNAUTHORIZED"),
    forbidden: (msg = "Forbidden") => new ApiError(403, msg, "FORBIDDEN"),
    notFound: (msg = "Not found") => new ApiError(404, msg, "NOT_FOUND"),
    withTeacherAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: Session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        try {
          return await handler(SESSION, ...args);
        } catch (error: unknown) {
          if (error instanceof ApiError) {
            return Response.json({ error: error.message }, { status: error.statusCode });
          }
          throw error;
        }
      },
  },
});

// The route resolves a db id OR a studentId username; the student's real db
// id differs from the route param so M5 regressions are visible.
const STUDENT_DB_ID = "cuid-student-1";
const assertStaffCanManageStudentMock = mock.fn(async () => ({
  id: STUDENT_DB_ID,
  displayName: "Morgan Vance",
  studentId: "morgan.vance",
  role: "student",
  isActive: true,
}));
mock.module("@/lib/classroom", {
  namedExports: { assertStaffCanManageStudent: assertStaffCanManageStudentMock },
});

type Row = Record<string, unknown> | null;
interface FindFirstArgs { where: { id: string; studentId: string } }

const findFirstMock = mock.fn(async (_args: FindFirstArgs): Promise<Row> => null);
const updateMock = mock.fn(async (_args: unknown): Promise<Row> => null);

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      formSubmission: { findFirst: findFirstMock, findMany: async () => [], update: updateMock },
      fileUpload: { findMany: async () => [] },
    },
  },
});

interface AuditArgs {
  summary: string;
  metadata: { counterSignature?: Record<string, unknown> } | null;
}
const tryLogAuditEventMock = mock.fn(async (_input: AuditArgs) => ({ audited: true }));
mock.module("@/lib/audit", { namedExports: { tryLogAuditEvent: tryLogAuditEventMock } });

const syncStudentAlertsMock = mock.fn(async (_studentId: string) => {});
mock.module("@/lib/advising", { namedExports: { syncStudentAlerts: syncStudentAlertsMock } });

const awardEventMock = mock.fn(async (_input: { studentId: string }) => {});
mock.module("@/lib/progression/events", { namedExports: { awardEvent: awardEventMock } });

// A canary: the route must not import or call the packet generator at all.
// If regeneration is ever re-added, these counts stop being zero.
const saveStampedIntakePacketMock = mock.fn(async () => ({ fileUploadId: "f1", storageKey: "k" }));
const createStampedIntakePdfBufferMock = mock.fn(async () => Buffer.from("%PDF"));
mock.module("@/lib/intake/pdf-stamped-packet", {
  namedExports: {
    saveStampedIntakePacket: saveStampedIntakePacketMock,
    createStampedIntakePdfBuffer: createStampedIntakePdfBufferMock,
  },
});

const SIGNATURE_DATA_URL = "data:image/png;base64,aGVsbG8=";

let route: typeof import("./route");

function patch(body: unknown, routeParam = "morgan.vance") {
  const req = new Request(`http://localhost:3000/api/teacher/students/${routeParam}/forms`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return route.PATCH(req as never, { params: Promise.resolve({ id: routeParam }) });
}

function auditArg(): AuditArgs {
  return tryLogAuditEventMock.mock.calls[0].arguments[0];
}

before(async () => {
  route = await import("./route");
});

describe("PATCH /api/teacher/students/[id]/forms", () => {
  beforeEach(() => {
    for (const m of [
      findFirstMock, updateMock, tryLogAuditEventMock, syncStudentAlertsMock,
      awardEventMock, saveStampedIntakePacketMock, createStampedIntakePdfBufferMock,
    ]) {
      m.mock.resetCalls();
    }
    tryLogAuditEventMock.mock.mockImplementation(async () => ({ audited: true }));
    findFirstMock.mock.mockImplementation(async () => ({
      id: "sub-1",
      studentId: STUDENT_DB_ID,
      formId: "orientation-intake",
    }));
    updateMock.mock.mockImplementation(async () => ({ id: "sub-1", status: "approved" }));
  });

  it("rejects a body that is not a valid review request", async () => {
    const res = await patch({ submissionId: "sub-1", status: "counter-signed" });
    assert.equal(res.status, 400);
  });

  it("rejects a signature that is not an image data URL", async () => {
    const res = await patch({
      submissionId: "sub-1",
      status: "approved",
      staffSignatureDataUrl: "javascript:alert(1)",
      staffSignatureName: "Dana Reeves",
    });
    assert.equal(res.status, 400);
  });

  // B4b. Approval used to re-render the stamped packet from placeholder
  // demographics and save it over the student's genuine signed one.
  it("never regenerates the compliance packet on approval", async () => {
    const res = await patch({
      submissionId: "sub-1",
      status: "approved",
      staffSignatureDataUrl: SIGNATURE_DATA_URL,
      staffSignatureName: "Dana Reeves",
      staffSignatureMethod: "drawn",
    });

    assert.equal(res.status, 200);
    assert.equal(saveStampedIntakePacketMock.mock.callCount(), 0);
    assert.equal(createStampedIntakePdfBufferMock.mock.callCount(), 0);
  });

  it("records the counter-signature as an audit attestation", async () => {
    await patch({
      submissionId: "sub-1",
      status: "approved",
      staffSignatureDataUrl: SIGNATURE_DATA_URL,
      staffSignatureName: "Dana Reeves",
      staffSignatureMethod: "drawn",
    });

    const sig = auditArg().metadata?.counterSignature;
    assert.ok(sig, "counter-signature missing from audit metadata");
    assert.equal(sig.signerName, "Dana Reeves");
    assert.equal(sig.signatureDataUrl, SIGNATURE_DATA_URL);
    assert.equal(sig.method, "drawn");
    assert.equal(sig.actorId, "teacher-1");
  });

  // The old fallbacks put "SPOKES Instructional Coordinator" on packets for
  // people who may hold no such title.
  it("records no signer title when nobody typed one", async () => {
    await patch({
      submissionId: "sub-1",
      status: "approved",
      staffSignatureDataUrl: SIGNATURE_DATA_URL,
      staffSignatureName: "Dana Reeves",
    });
    assert.equal(auditArg().metadata?.counterSignature?.signerTitle, null);
  });

  // The summary read "Approved and counter-signed" unconditionally.
  it("says an approval was NOT counter-signed when no signature was sent", async () => {
    const res = await patch({ submissionId: "sub-1", status: "approved" });
    const summary = auditArg().summary;

    assert.match(summary, /No counter-signature was supplied/);
    assert.doesNotMatch(summary, /counter-signed/);
    assert.equal(auditArg().metadata, null);
    assert.equal((await res.json()).counterSignatureRecorded, false);
  });

  it("names the signer in the summary when there is one", async () => {
    await patch({
      submissionId: "sub-1",
      status: "approved",
      staffSignatureDataUrl: SIGNATURE_DATA_URL,
      staffSignatureName: "Dana Reeves",
    });
    assert.match(auditArg().summary, /recorded a counter-signature by Dana Reeves/);
  });

  it("reports the counter-signature as unrecorded when the audit write fails", async () => {
    tryLogAuditEventMock.mock.mockImplementation(async () => ({ audited: false }));

    const res = await patch({
      submissionId: "sub-1",
      status: "approved",
      staffSignatureDataUrl: SIGNATURE_DATA_URL,
      staffSignatureName: "Dana Reeves",
    });
    const payload = await res.json();

    assert.equal(payload.audited, false);
    assert.equal(payload.counterSignatureRecorded, false);
  });

  it("describes a rejection as a return for revision", async () => {
    await patch({ submissionId: "sub-1", status: "rejected", notes: "Missing page 2" });
    assert.match(auditArg().summary, /Returned form submission orientation-intake/);
  });

  // M5. The route is reachable by studentId username; the resolved db id has
  // to reach the ownership check, the XP award and the alert sync, or they
  // silently address nothing while the audit row still claims success.
  it("uses the resolved student db id, not the raw route param", async () => {
    await patch({ submissionId: "sub-1", status: "approved" }, "morgan.vance");

    assert.equal(findFirstMock.mock.calls[0].arguments[0].where.studentId, STUDENT_DB_ID);
    assert.equal(awardEventMock.mock.calls[0].arguments[0].studentId, STUDENT_DB_ID);
    assert.equal(syncStudentAlertsMock.mock.calls[0].arguments[0], STUDENT_DB_ID);
  });

  it("404s a submission belonging to another student", async () => {
    findFirstMock.mock.mockImplementation(async () => null);
    const res = await patch({ submissionId: "sub-other", status: "approved" });
    assert.equal(res.status, 404);
  });
});
