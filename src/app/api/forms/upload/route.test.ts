import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

/**
 * Same defense-in-depth as `/api/files`: the orientation form upload writes
 * `File.name` into `FileUpload.filename`, and that column later becomes a ZIP
 * entry path in the retention archive.
 */

// acceptsSubmission: true in src/lib/spokes/forms.ts
const FORM_ID = "student-profile";

const student = mockStudentSession();
const teacher = mockTeacherSession();
let currentSession: Session = student;
const mockSyncStudentAlerts = mock.fn<(studentId: string) => Promise<void>>(async () => undefined);
const mockUploadFile = mock.fn(async () => undefined);

const mockFileUploadCreate =
  mock.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>();

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => currentSession,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      fileUpload: { create: mockFileUploadCreate },
      formSubmission: { upsert: async () => ({ id: "sub-1" }) },
    },
  },
});

mock.module("@/lib/storage", {
  namedExports: {
    generateStorageKey: (studentId: string) => `${studentId}/uuid.pdf`,
    uploadFile: mockUploadFile,
    validateFile: () => null,
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
      warn: () => undefined,
      error: () => undefined,
    },
  },
});

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

function uploadRequest(filename: string) {
  const form = new FormData();
  form.set("file", new File(["%PDF-1.7\n"], filename, { type: "application/pdf" }));
  form.set("formId", FORM_ID);
  return new Request("http://localhost:3000/api/forms/upload", { method: "POST", body: form });
}

describe("POST /api/forms/upload — persisted filename", () => {
  beforeEach(() => {
    mockUploadFile.mock.resetCalls();
    mockFileUploadCreate.mock.resetCalls();
    mockFileUploadCreate.mock.mockImplementation(async () => ({ id: "file-1" }));
  });

  it("rejects text fields and spoofed PDF bytes before any writes", async () => {
    for (const value of ["not a file", new File(["<script>alert(1)</script>"], "attack.pdf", { type: "application/pdf" })]) {
      const body = new FormData();
      body.set("file", value);
      body.set("formId", FORM_ID);
      const res = await route.POST(new Request("http://localhost/api/forms/upload", { method: "POST", body }) as never);
      assert.equal(res.status, 400);
    }
    assert.equal(mockUploadFile.mock.callCount(), 0);
    assert.equal(mockFileUploadCreate.mock.callCount(), 0);
  });

  it("stores the basename of a traversal filename, not the path", async () => {
    const res = await route.POST(uploadRequest("../../forms/DoHS Release.pdf") as never);

    assert.equal(res.status, 200);
    assert.equal(
      mockFileUploadCreate.mock.calls[0].arguments[0].data.filename,
      "DoHS Release.pdf",
    );
  });

  it("leaves an ordinary filename readable", async () => {
    const res = await route.POST(uploadRequest("signed-referral.pdf") as never);

    assert.equal(res.status, 200);
    assert.equal(
      mockFileUploadCreate.mock.calls[0].arguments[0].data.filename,
      "signed-referral.pdf",
    );
  });
});

function holdSync(): () => void {
  let release: () => void = () => undefined;
  mockSyncStudentAlerts.mock.mockImplementation(() => new Promise<void>((resolve) => {
    release = resolve;
  }));
  return () => release();
}

async function settlesWithin(work: Promise<Response>, ms: number): Promise<Response | "pending"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Promise<"pending">((resolve) => {
    timer = setTimeout(() => resolve("pending"), ms);
  });
  const outcome = await Promise.race([work, pending]);
  clearTimeout(timer);
  return outcome;
}

describe("POST /api/forms/upload — alert sync", () => {
  beforeEach(() => {
    currentSession = student;
    mockSyncStudentAlerts.mock.resetCalls();
    mockFileUploadCreate.mock.mockImplementation(async () => ({ id: "file-1" }));
  });

  it("answers a student without waiting for the sync, and still starts it", async () => {
    const release = holdSync();
    const outcome = await settlesWithin(route.POST(uploadRequest("form.pdf") as never), 2000);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    if (outcome === "pending") assert.fail("the student's response waited on the alert sync");
    assert.equal(outcome.status, 200);
    assert.deepEqual(mockSyncStudentAlerts.mock.calls[0].arguments, [student.id]);
  });

  it("keeps a staff upload waiting for the sync, so the instructor's queue is fresh", async () => {
    currentSession = teacher;
    const release = holdSync();
    const request = new FormData();
    request.set("file", new File(["%PDF-1.7\n"], "form.pdf", { type: "application/pdf" }));
    request.set("formId", FORM_ID);
    request.set("studentId", student.id);
    const work = route.POST(new Request("http://localhost:3000/api/forms/upload", { method: "POST", body: request }) as never);
    assert.equal(await settlesWithin(work, 200), "pending", "a staff upload must await the sync");
    release();
    const res = await work;
    assert.equal(res.status, 200);
    assert.deepEqual(mockSyncStudentAlerts.mock.calls[0].arguments, [student.id]);
  });
});

