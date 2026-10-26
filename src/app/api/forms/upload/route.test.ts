import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession } from "@/lib/test-helpers";

/**
 * Same defense-in-depth as `/api/files`: the orientation form upload writes
 * `File.name` into `FileUpload.filename`, and that column later becomes a ZIP
 * entry path in the retention archive.
 */

// acceptsSubmission: true in src/lib/spokes/forms.ts
const FORM_ID = "student-profile";

const student = mockStudentSession();
const mockUploadFile = mock.fn(async () => undefined);

const mockFileUploadCreate =
  mock.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>();

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => student,
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
    syncStudentAlerts: async () => undefined,
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
