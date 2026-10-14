import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

let session: Session | null = mockStudentSession();
const file = { id: "file-1", studentId: "student-1", filename: "document.pdf", storageKey: "student-1/file.pdf", mimeType: "application/pdf" };
const findFirst = mock.fn(async (_args: unknown): Promise<typeof file | null> => file);
const download = mock.fn(async (): Promise<{ buffer: Buffer; mimeType: string } | null> => ({ buffer: Buffer.from("%PDF-1.7\n"), mimeType: "application/pdf" }));
const presign = mock.fn(async (_key: string, _options: { contentType?: string }): Promise<string | null> => null);
const scope = mock.fn(async (_session: Session, _studentId: string) => undefined);
mock.module("@/lib/auth", { namedExports: { getSession: async () => session } });
mock.module("@/lib/db", { namedExports: { prisma: { fileUpload: { findFirst } } } });
mock.module("@/lib/storage", { namedExports: { downloadFile: download, getPresignedDownloadUrl: presign } });
mock.module("@/lib/classroom", { namedExports: { assertStaffCanManageStudent: scope } });
let route: typeof import("./route");
before(async () => { route = await import("./route"); });
const get = (query = "?id=file-1") => route.GET(new Request(`http://localhost/api/files/download${query}`));

describe("file download release security", () => {
  beforeEach(() => {
    session = mockStudentSession();
    for (const fn of [findFirst, download, presign, scope]) fn.mock.resetCalls();
    findFirst.mock.mockImplementation(async () => file);
    download.mock.mockImplementation(async () => ({ buffer: Buffer.from("%PDF-1.7\n"), mimeType: "application/pdf" }));
    presign.mock.mockImplementation(async () => null);
  });
  it("requires authentication and an id", async () => {
    assert.equal((await get("")).status, 400);
    session = null;
    assert.equal((await get()).status, 401);
    assert.equal(findFirst.mock.callCount(), 0);
  });
  it("scopes student reads to their own uploads", async () => {
    assert.equal((await get()).status, 200);
    assert.deepEqual(findFirst.mock.calls[0].arguments[0], { where: { id: file.id, studentId: session!.id } });
  });
  it("checks the teacher's student scope before storage access", async () => {
    session = { ...mockStudentSession(), role: "teacher" };
    await get();
    assert.deepEqual(scope.mock.calls[0].arguments, [session, file.studentId]);
  });
  it("returns 404 for missing database rows or stored objects", async () => {
    findFirst.mock.mockImplementation(async () => null);
    assert.equal((await get()).status, 404);
    assert.equal(download.mock.callCount(), 0);
    findFirst.mock.mockImplementation(async () => file);
    download.mock.mockImplementation(async () => null);
    assert.equal((await get()).status, 404);
  });
  it("returns the stored PDF bytes with passive type and private headers", async () => {
    const res = await get();
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "%PDF-1.7\n");
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  });
  it("does not trust PDF metadata when the stored bytes are HTML", async () => {
    download.mock.mockImplementation(async () => ({ buffer: Buffer.from("<script>alert(1)</script>"), mimeType: "application/pdf" }));
    const res = await get();
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });
  it("overrides active MIME types on presigned downloads", async () => {
    findFirst.mock.mockImplementation(async () => ({ ...file, mimeType: "text/html" }));
    presign.mock.mockImplementation(async () => "https://storage.example/download");
    const res = await get();
    assert.equal(res.status, 302);
    assert.equal(presign.mock.calls[0].arguments[1].contentType, "application/octet-stream");
    assert.equal(download.mock.callCount(), 0);
  });
});
