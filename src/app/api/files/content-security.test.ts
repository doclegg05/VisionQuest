import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession } from "@/lib/test-helpers";

const student = mockStudentSession();
const upload = mock.fn(async () => undefined);
const create = mock.fn(async () => ({ id: "file-1" }));
mock.module("@/lib/auth", { namedExports: { getSession: async () => student } });
mock.module("@/lib/db", { namedExports: { prisma: { fileUpload: { create } } } });
mock.module("@/lib/storage", {
  namedExports: {
    generateStorageKey: () => "student/file.pdf",
    uploadFile: upload,
    deleteFile: async () => undefined,
    validateFile: () => null, // Exercise byte validation independently of metadata.
  },
});
let route: typeof import("./route");
before(async () => { route = await import("./route"); });

async function post(value: string | File) {
  const body = new FormData();
  body.set("file", value);
  return route.POST(new Request("http://localhost/api/files", { method: "POST", body }));
}

describe("POST /api/files content validation", () => {
  beforeEach(() => { upload.mock.resetCalls(); create.mock.resetCalls(); });
  it("rejects text form fields in place of files", async () => {
    assert.equal((await post("not a file")).status, 400);
    assert.equal(upload.mock.callCount(), 0);
    assert.equal(create.mock.callCount(), 0);
  });
  it("rejects HTML spoofed as a PDF before storage or database writes", async () => {
    const res = await post(new File(["<script>alert(1)</script>"], "attack.pdf", { type: "application/pdf" }));
    assert.equal(res.status, 400);
    assert.equal(upload.mock.callCount(), 0);
    assert.equal(create.mock.callCount(), 0);
  });
  it("preserves supported PDF uploads", async () => {
    const res = await post(new File(["%PDF-1.7\n"], "document.pdf", { type: "application/pdf" }));
    assert.equal(res.status, 200);
    assert.equal(upload.mock.callCount(), 1);
    assert.equal(create.mock.callCount(), 1);
  });
});
