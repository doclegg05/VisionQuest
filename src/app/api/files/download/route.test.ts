import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";

let currentSession: Session = {
  id: "teacher-1",
  studentId: "",
  role: "teacher",
  displayName: "Test Teacher",
};

mock.module("@/lib/api-error", {
  namedExports: {
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
    withAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: Session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        return await handler(currentSession, ...args);
      },
  },
});

const assertStaffCanManageStudentMock = mock.fn(async () => ({ id: "student-1" }));
mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageStudent: assertStaffCanManageStudentMock,
  },
});

const downloadFileMock = mock.fn(async () => null as { buffer: Buffer; mimeType: string } | null);
const uploadFileMock = mock.fn(async () => undefined);
const getPresignedDownloadUrlMock = mock.fn(async () => null as string | null);

mock.module("@/lib/storage", {
  namedExports: {
    downloadFile: downloadFileMock,
    uploadFile: uploadFileMock,
    getPresignedDownloadUrl: getPresignedDownloadUrlMock,
  },
});

const prismaFindFirstMock = mock.fn() as any;
const prismaFindUniqueMock = mock.fn() as any;
const formResponseFindUniqueMock = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      fileUpload: {
        findFirst: prismaFindFirstMock,
      },
      student: {
        findUnique: prismaFindUniqueMock,
      },
      formResponse: {
        findUnique: formResponseFindUniqueMock,
      },
    },
  },
});

const createStampedIntakePdfBufferMock = mock.fn(async () => Buffer.from("%PDF-1.4 mock pdf"));
mock.module("@/lib/intake/pdf-stamped-packet", {
  namedExports: {
    createStampedIntakePdfBuffer: createStampedIntakePdfBufferMock,
  },
});

const INTAKE_FILE = {
  id: "file-intake-1",
  studentId: "student-1",
  filename: "Official_Intake_Packet_morgan.vance.pdf",
  storageKey: "orientation/student-1/intake-123.pdf",
  category: "orientation",
  uploadedAt: new Date("2026-09-01"),
};

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

describe("GET /api/files/download", () => {
  beforeEach(() => {
    downloadFileMock.mock.resetCalls();
    downloadFileMock.mock.mockImplementation(async () => null);
    uploadFileMock.mock.resetCalls();
    getPresignedDownloadUrlMock.mock.resetCalls();
    getPresignedDownloadUrlMock.mock.mockImplementation(async () => null);
    prismaFindFirstMock.mock.resetCalls();
    prismaFindUniqueMock.mock.resetCalls();
    formResponseFindUniqueMock.mock.resetCalls();
    createStampedIntakePdfBufferMock.mock.resetCalls();

    // A real, resolvable student with a SPOKES record and a submitted profile
    // form: everything the deleted "self-healing" block needed to manufacture a
    // replacement packet. Without these the fabrication path short-circuits and
    // the tests below pass for the wrong reason.
    prismaFindUniqueMock.mock.mockImplementation(async () => ({
      id: "student-1",
      studentId: "morgan.vance",
      displayName: "Morgan Vance",
      email: "morgan@example.com",
      spokesRecord: {
        firstName: "Morgan",
        lastName: "Vance",
        county: "Nicholas",
        birthDate: new Date("1997-08-22"),
        barriersOnEntry: ["tanf"],
      },
    }));
    formResponseFindUniqueMock.mock.mockImplementation(async () => ({
      answers: {
        first_name: "Morgan",
        last_name: "Vance",
        phone: "(304) 555-0819",
        tanf_status: true,
      },
    }));
  });

  it("returns 400 when id query parameter is missing", async () => {
    const req = new Request("http://localhost:3000/api/files/download");
    const res = await route.GET(req);
    assert.equal(res.status, 400);
  });

  it("returns 404 when file upload record is not in database", async () => {
    prismaFindFirstMock.mock.mockImplementation(async () => null);
    const req = new Request("http://localhost:3000/api/files/download?id=file-1");
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  it("returns the stored object when storage has it", async () => {
    prismaFindFirstMock.mock.mockImplementation(async () => INTAKE_FILE);
    downloadFileMock.mock.mockImplementation(async () => ({
      buffer: Buffer.from("%PDF-1.4 the real signed packet"),
      mimeType: "application/pdf",
    }));

    const req = new Request("http://localhost:3000/api/files/download?id=file-intake-1");
    const res = await route.GET(req);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(
      Buffer.from(await res.arrayBuffer()).toString(),
      "%PDF-1.4 the real signed packet",
    );
  });

  // B4a. A missing orientation packet used to be "self-healed": the route
  // synthesized a replacement from invented demographics with
  // ferpaConsentSigned/policyAcknowledgmentSigned hardcoded true and a
  // signature block naming the student, then wrote it over the canonical
  // storage key. That manufactures a signed FERPA consent for a state-audited
  // TANF program and makes it indistinguishable from a real one. A missing
  // file is a 404.
  it("returns 404 for a missing intake packet instead of fabricating a signed one", async () => {
    prismaFindFirstMock.mock.mockImplementation(async () => INTAKE_FILE);

    const req = new Request("http://localhost:3000/api/files/download?id=file-intake-1");
    const res = await route.GET(req);

    assert.equal(res.status, 404);
    assert.equal(createStampedIntakePdfBufferMock.mock.callCount(), 0);
  });

  it("never writes to storage on a read, even when the object is missing", async () => {
    prismaFindFirstMock.mock.mockImplementation(async () => INTAKE_FILE);

    const req = new Request("http://localhost:3000/api/files/download?id=file-intake-1");
    await route.GET(req);

    assert.equal(uploadFileMock.mock.callCount(), 0);
  });

  it("does not re-derive student demographics when the object is missing", async () => {
    prismaFindFirstMock.mock.mockImplementation(async () => INTAKE_FILE);

    const req = new Request("http://localhost:3000/api/files/download?id=file-intake-1");
    await route.GET(req);

    assert.equal(prismaFindUniqueMock.mock.callCount(), 0);
    assert.equal(formResponseFindUniqueMock.mock.callCount(), 0);
  });
});
