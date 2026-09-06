import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession } from "@/lib/test-helpers";

/**
 * Same defense-in-depth as `/api/files`: handing Sage a file in chat writes
 * `File.name` into `FileUpload.filename`, and that column later becomes a ZIP
 * entry path in the retention archive.
 */

const student = mockStudentSession();

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
    uploadFile: async () => undefined,
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
  form.set("file", new File([new Uint8Array([1, 2, 3])], filename, { type: "application/pdf" }));
  return new Request("http://localhost:3000/api/chat/upload", { method: "POST", body: form });
}

describe("POST /api/chat/upload — persisted filename", () => {
  beforeEach(() => {
    mockFileUploadCreate.mock.resetCalls();
    mockFileUploadCreate.mock.mockImplementation(async (args) => ({ id: "f1", ...args.data }));
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
