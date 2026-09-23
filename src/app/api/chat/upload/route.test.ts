import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession } from "@/lib/test-helpers";

/**
 * Same defense-in-depth as `/api/files`: handing Sage a file in chat writes
 * `File.name` into `FileUpload.filename`, and that column later becomes a ZIP
 * entry path in the retention archive.
 */

const student = mockStudentSession();
const mockUploadFile = mock.fn(async () => undefined);

const mockFileUploadCreate =
  mock.fn<(args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>>();

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => student,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      fileUpload: { create: mockFileUploadCreate },
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

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: async () => ({ success: true }),
  },
});

mock.module("@/lib/consent", {
  namedExports: {
    hasActiveConsent: async () => false,
  },
});

mock.module("@/lib/sage/file-gist", {
  namedExports: {
    buildFileGist: async () => ({ gist: "a document", method: "local" }),
  },
});

mock.module("@/lib/sage/attachment-classify", {
  namedExports: {
    ensureClassification: async () => undefined,
  },
});

mock.module("@/lib/ai/audit", {
  namedExports: {
    logAiAuditEvent: async () => undefined,
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
  return new Request("http://localhost:3000/api/chat/upload", { method: "POST", body: form });
}

describe("POST /api/chat/upload — persisted filename", () => {
  beforeEach(() => {
    mockUploadFile.mock.resetCalls();
    mockFileUploadCreate.mock.resetCalls();
    mockFileUploadCreate.mock.mockImplementation(async (args) => ({ id: "f1", ...args.data }));
  });

  it("rejects text fields and spoofed PDF bytes before any writes", async () => {
    for (const value of ["not a file", new File(["<script>alert(1)</script>"], "attack.pdf", { type: "application/pdf" })]) {
      const body = new FormData();
      body.set("file", value);
      const res = await route.POST(new Request("http://localhost/api/chat/upload", { method: "POST", body }));
      assert.equal(res.status, 400);
    }
    assert.equal(mockUploadFile.mock.callCount(), 0);
    assert.equal(mockFileUploadCreate.mock.callCount(), 0);
  });

  it("stores the basename of a traversal filename, not the path", async () => {
    const res = await route.POST(uploadRequest("..\\..\\etc\\cron.d\\x.pdf") as never);

    assert.equal(res.status, 200);
    assert.equal(mockFileUploadCreate.mock.calls[0].arguments[0].data.filename, "x.pdf");
  });

  it("leaves an ordinary filename readable", async () => {
    const res = await route.POST(uploadRequest("my notes.pdf") as never);

    assert.equal(res.status, 200);
    assert.equal(mockFileUploadCreate.mock.calls[0].arguments[0].data.filename, "my notes.pdf");
  });
});
