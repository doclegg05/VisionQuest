/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

const session = mockTeacherSession();

const mockStudentFindUnique = mock.fn() as any;
const mockOrientationItemFindMany = mock.fn() as any;
const mockCertTemplateFindMany = mock.fn() as any;
const mockFileUploadFindMany = mock.fn() as any;
const mockProgramDocumentFindMany = mock.fn() as any;
const mockOpportunityFindMany = mock.fn() as any;
const mockCareerEventFindMany = mock.fn() as any;
const mockAssertStaffCanManageStudent = mock.fn() as any;
const mockRecordStudentView = mock.fn() as any;

mock.module("server-only", { namedExports: {} });

mock.module("@/lib/registry/middleware", {
  namedExports: {
    withRegistry:
      (
        _toolId: string,
        handler: (
          sessionArg: typeof session,
          req: Request,
          ctx: { params: Promise<Record<string, string>> },
          tool: unknown,
        ) => Promise<Response>,
      ) =>
      async (req: Request, ctx: { params: Promise<Record<string, string>> }) =>
        handler(session, req, ctx, { id: "admin.student_detail" }),
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageStudent: mockAssertStaffCanManageStudent,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    recordStudentView: mockRecordStudentView,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: { findUnique: mockStudentFindUnique },
      orientationItem: { findMany: mockOrientationItemFindMany },
      certTemplate: { findMany: mockCertTemplateFindMany },
      fileUpload: { findMany: mockFileUploadFindMany },
      programDocument: { findMany: mockProgramDocumentFindMany },
      opportunity: { findMany: mockOpportunityFindMany },
      careerEvent: { findMany: mockCareerEventFindMany },
      // Match & Connect Phase 2: the route reads the student's work profile
      // through getWorkProfile(). Null here — the panel's own tests cover the
      // populated case.
      studentWorkProfile: { findUnique: async () => null },
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

// Ready-to-work listed FIRST so the pre-fix single-cert mapping
// (student.certifications[0]) would misattribute the IC3 link's evidence.
function makeStudent() {
  return {
    id: "student-1",
    studentId: "VQ-0001",
    displayName: "Test Student",
    email: "student@example.com",
    isActive: true,
    createdAt: new Date("2026-05-01T12:00:00.000Z"),
    classEnrollments: [],
    progression: null,
    goals: [
      {
        id: "goal-1",
        level: "monthly",
        content: "Earn the IC3 credential.",
        status: "active",
        parentId: null,
        pathwayId: null,
        createdAt: new Date("2026-06-01T12:00:00.000Z"),
        pathway: null,
      },
    ],
    goalResourceLinks: [
      {
        id: "link-1",
        goalId: "goal-1",
        resourceType: "certification",
        resourceId: "ic3",
        title: "IC3 Digital Literacy",
        description: null,
        url: null,
        linkType: "assigned",
        status: "assigned",
        dueAt: null,
        notes: null,
        assignedById: "teacher-1",
        createdAt: new Date("2026-06-02T12:00:00.000Z"),
        updatedAt: new Date("2026-06-02T12:00:00.000Z"),
      },
    ],
    orientationProgress: [],
    certifications: [
      {
        id: "cert-rtw",
        certType: "ready-to-work",
        status: "in_progress",
        startedAt: new Date("2026-05-10T12:00:00.000Z"),
        completedAt: null,
        verificationStatus: null,
        verifiedAt: null,
        requirements: [],
      },
      {
        id: "cert-ic3",
        certType: "ic3",
        status: "completed",
        startedAt: new Date("2026-05-15T12:00:00.000Z"),
        completedAt: new Date("2026-06-10T12:00:00.000Z"),
        verificationStatus: "verified",
        verifiedAt: new Date("2026-06-11T12:00:00.000Z"),
        requirements: [],
      },
    ],
    publicCredentialPage: null,
    formSubmissions: [],
    portfolioItems: [],
    applications: [],
    eventRegistrations: [],
    resumeData: null,
    files: [],
    appointments: [],
    assignedTasks: [],
    caseNotes: [],
    alerts: [],
    conversations: [],
    careerDiscovery: null,
  };
}

describe("GET /api/teacher/students/[id]", () => {
  beforeEach(() => {
    mockStudentFindUnique.mock.resetCalls();
    mockOrientationItemFindMany.mock.resetCalls();
    mockCertTemplateFindMany.mock.resetCalls();
    mockFileUploadFindMany.mock.resetCalls();
    mockProgramDocumentFindMany.mock.resetCalls();
    mockOpportunityFindMany.mock.resetCalls();
    mockCareerEventFindMany.mock.resetCalls();
    mockAssertStaffCanManageStudent.mock.resetCalls();
    mockRecordStudentView.mock.resetCalls();

    mockStudentFindUnique.mock.mockImplementation(async () => makeStudent());
    mockOrientationItemFindMany.mock.mockImplementation(async () => []);
    mockCertTemplateFindMany.mock.mockImplementation(async () => []);
    mockFileUploadFindMany.mock.mockImplementation(async () => []);
    mockProgramDocumentFindMany.mock.mockImplementation(async () => []);
    mockOpportunityFindMany.mock.mockImplementation(async () => []);
    mockCareerEventFindMany.mock.mockImplementation(async () => []);
    mockAssertStaffCanManageStudent.mock.mockImplementation(async () => ({ id: "student-1" }));
    mockRecordStudentView.mock.mockImplementation(async () => undefined);
  });

  it("selects certType and maps certification evidence per cert, not certifications[0]", async () => {
    const req = mockRequest("/api/teacher/students/student-1", { method: "GET" });
    const ctx = { params: Promise.resolve({ id: "student-1" }) };

    const res = await route.GET(req as never, ctx as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(
      mockStudentFindUnique.mock.calls[0]?.arguments[0].select.certifications.select.certType,
      true,
    );

    // The IC3 link must draw evidence from the completed ic3 cert even though
    // the in-progress ready-to-work cert sits at certifications[0].
    const evidence = body.goalEvidence.find(
      (entry: { resourceId: string }) => entry.resourceId === "ic3",
    );
    assert.ok(evidence);
    assert.equal(evidence.evidenceStatus, "approved");
    assert.equal(evidence.summary, "IC3 Digital Literacy is complete.");
  });

  // Review W2 (2026-09-06). The sibling route
  // (teacher/students/[id]/forms/route.ts:32) scopes this same lookup by
  // `studentId`; this one did not. A `FormSubmission` row written before the
  // ownership check existed can carry a `fileId` belonging to another
  // student, and the student-detail page renders that file's name and a
  // download link. Reading nothing is the right failure: the file entry is
  // already nullable and the UI handles a missing one.
  //
  // The path segment here is the HUMAN login id, which
  // `assertStaffCanManageStudent` also accepts (buildStudentIdentifierWhere),
  // while the resolved row's id is the cuid. Scoping on the path segment
  // would look correct and return zero files for every teacher who arrived by
  // the login id, so the assertion pins the resolved id.
  it("scopes the form-file lookup to the resolved student, not the path segment", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () => ({
      ...makeStudent(),
      formSubmissions: [
        {
          id: "sub-1",
          formId: "spokes-intake",
          fileId: "file-belonging-to-another-student",
          signatureFileId: "sig-belonging-to-another-student",
          submittedAt: new Date("2026-06-03T12:00:00.000Z"),
          status: "submitted",
        },
      ],
    }));

    const req = mockRequest("/api/teacher/students/VQ-0001", { method: "GET" });
    const ctx = { params: Promise.resolve({ id: "VQ-0001" }) };

    const res = await route.GET(req as never, ctx as never);
    assert.equal(res.status, 200);

    const where = mockFileUploadFindMany.mock.calls[0]?.arguments[0]?.where;
    assert.ok(where, "the route must have looked the form files up");
    assert.deepEqual(where.id, {
      in: ["file-belonging-to-another-student", "sig-belonging-to-another-student"],
    });
    assert.equal(
      where.studentId,
      "student-1",
      "a form file is only ever shown on the detail page of the student who owns it",
    );
  });
});
