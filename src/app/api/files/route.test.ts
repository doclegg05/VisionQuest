import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession } from "@/lib/test-helpers";

/**
 * The persisted `filename` must not be a path.
 *
 * `File.name` reaches the route verbatim through `req.formData()`, and the
 * column is read back later by code that treats it as a name — most sharply by
 * the retention archive, which turns it into a ZIP entry path. The archive
 * boundary sanitizes authoritatively; this is the defense-in-depth layer that
 * stops new rows carrying a path in the first place.
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
      fileUpload: {
        create: mockFileUploadCreate,
        findMany: async () => [],
        findFirst: async () => null,
        delete: async () => ({}),
      },
    },
  },
});

mock.module("@/lib/storage", {
  namedExports: {
    generateStorageKey: (studentId: string) => `${studentId}/uuid.pdf`,
    uploadFile: async () => undefined,
    deleteFile: async () => undefined,
    validateFile: () => null,
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
  return new Request("http://localhost:3000/api/files", { method: "POST", body: form });
}

describe("POST /api/files — persisted filename", () => {
  beforeEach(() => {
    mockFileUploadCreate.mock.resetCalls();
    mockFileUploadCreate.mock.mockImplementation(async (args) => ({ id: "f1", ...args.data }));
  });

  it("stores the basename of a traversal filename, not the path", async () => {
    const res = await route.POST(uploadRequest("../../../../home/staff/.bashrc") as never);

    assert.equal(res.status, 200);
    const stored = mockFileUploadCreate.mock.calls[0].arguments[0].data.filename;
    assert.equal(stored, "bashrc");
  });

  it("leaves an ordinary filename readable", async () => {
    const res = await route.POST(uploadRequest("Resume 2026 (final).pdf") as never);

    assert.equal(res.status, 200);
    assert.equal(
      mockFileUploadCreate.mock.calls[0].arguments[0].data.filename,
      "Resume 2026 (final).pdf",
    );
  });
});
