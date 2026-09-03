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

const downloadFileMock = mock.fn(async () => null);
const uploadFileMock = mock.fn(async () => undefined);
const getPresignedDownloadUrlMock = mock.fn(async () => null);

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

mock.module("@/lib/intake/pdf-stamped-packet", {
  namedExports: {
    createStampedIntakePdfBuffer: mock.fn(async () => Buffer.from("%PDF-1.4 mock pdf")),
  },
});

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

describe("GET /api/files/download", () => {
  beforeEach(() => {
    downloadFileMock.mock.resetCalls();
    uploadFileMock.mock.resetCalls();
    prismaFindFirstMock.mock.resetCalls();
    prismaFindUniqueMock.mock.resetCalls();
    formResponseFindUniqueMock.mock.resetCalls();
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

  it("self-heals missing intake packet by generating stamped state PDF and returning 200", async () => {
    prismaFindFirstMock.mock.mockImplementation(async () => ({
      id: "file-intake-1",
      studentId: "student-1",
      filename: "Official_Intake_Packet_morgan.vance.pdf",
      storageKey: "orientation/student-1/intake-123.pdf",
      category: "orientation",
      uploadedAt: new Date("2026-09-01"),
    }));

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

    downloadFileMock.mock.mockImplementation(async () => null); // Simulate missing storage file!

    const req = new Request("http://localhost:3000/api/files/download?id=file-intake-1");
    const res = await route.GET(req);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(uploadFileMock.mock.callCount(), 1); // Confirms it was self-healed and cached in storage!
  });
});
