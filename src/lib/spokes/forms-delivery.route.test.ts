import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { mockStudentSession } from "@/lib/test-helpers";

// /api/forms/download must not 302 to a presigned URL for an object that is
// not in the bucket — that hands the browser the storage provider's 404 and
// skips the bundled-PDF fallback entirely (the Sage "Open form" symptom when
// USE_PRESIGNED_URLS is enabled).

const STUDENT_PROFILE_ID = "student-profile";
const PDF_BYTES = Buffer.from("%PDF-1.4 fake-but-plausible");

let currentSession: Session | null = mockStudentSession();
const mockDownloadFile = mock.fn<
  (storageKey: string) => Promise<{ buffer: Buffer; mimeType: string } | null>
>();
const mockGetPresignedDownloadUrl = mock.fn<
  (storageKey: string, options?: unknown) => Promise<string | null>
>();
const mockStorageObjectExists = mock.fn<(storageKey: string) => Promise<boolean>>();

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => currentSession,
  },
});

mock.module("@/lib/storage", {
  namedExports: {
    downloadFile: mockDownloadFile,
    getPresignedDownloadUrl: mockGetPresignedDownloadUrl,
    storageObjectExists: mockStorageObjectExists,
  },
});

let route: typeof import("@/app/api/forms/download/route");

before(async () => {
  route = await import("@/app/api/forms/download/route");
});

function request(query: string): Request {
  return new Request(`http://localhost/api/forms/download?${query}`);
}

describe("GET /api/forms/download presigned-redirect guard", () => {
  beforeEach(() => {
    currentSession = mockStudentSession();
    mockDownloadFile.mock.resetCalls();
    mockGetPresignedDownloadUrl.mock.resetCalls();
    mockStorageObjectExists.mock.resetCalls();

    mockDownloadFile.mock.mockImplementation(async () => ({
      buffer: PDF_BYTES,
      mimeType: "application/pdf",
    }));
    mockGetPresignedDownloadUrl.mock.mockImplementation(
      async () => "https://bucket.example.com/presigned/student-profile",
    );
    mockStorageObjectExists.mock.mockImplementation(async () => true);
  });

  it("redirects to the presigned URL when the bucket object exists", async () => {
    const res = await route.GET(request(`formId=${STUDENT_PROFILE_ID}&mode=view`));

    assert.equal(res.status, 302);
    assert.equal(
      res.headers.get("location"),
      "https://bucket.example.com/presigned/student-profile",
    );
    assert.equal(mockDownloadFile.mock.callCount(), 0);
  });

  it("falls through to the bundled download when the bucket object is MISSING", async () => {
    mockStorageObjectExists.mock.mockImplementation(async () => false);

    const res = await route.GET(request(`formId=${STUDENT_PROFILE_ID}&mode=view`));

    assert.equal(
      res.status,
      200,
      "must not redirect to a presigned URL for a missing object — that serves the provider's 404",
    );
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(mockDownloadFile.mock.callCount(), 1);
  });

  it("falls through when the existence check itself fails", async () => {
    mockStorageObjectExists.mock.mockImplementation(async () => {
      throw new Error("HeadObject exploded");
    });

    const res = await route.GET(request(`formId=${STUDENT_PROFILE_ID}&mode=view`));

    assert.equal(res.status, 200);
    assert.equal(mockDownloadFile.mock.callCount(), 1);
  });

  it("serves the buffer directly when presigned URLs are disabled", async () => {
    mockGetPresignedDownloadUrl.mock.mockImplementation(async () => null);

    const res = await route.GET(request(`formId=${STUDENT_PROFILE_ID}&mode=download`));

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.match(String(res.headers.get("content-disposition")), /^attachment/);
  });

  it("404s with the instructor-upload message when nothing can serve the file", async () => {
    mockGetPresignedDownloadUrl.mock.mockImplementation(async () => null);
    mockDownloadFile.mock.mockImplementation(async () => null);

    const res = await route.GET(request(`formId=${STUDENT_PROFILE_ID}`));
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.match(String(body.message), /not been uploaded/i);
  });

  it("401s without a session", async () => {
    currentSession = null;

    const res = await route.GET(request(`formId=${STUDENT_PROFILE_ID}`));

    assert.equal(res.status, 401);
    assert.equal(mockDownloadFile.mock.callCount(), 0);
  });

  it("404s an unknown formId without touching storage", async () => {
    const res = await route.GET(request("formId=totally-unknown-form"));

    assert.equal(res.status, 404);
    assert.equal(mockGetPresignedDownloadUrl.mock.callCount(), 0);
    assert.equal(mockDownloadFile.mock.callCount(), 0);
  });
});
