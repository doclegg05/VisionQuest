/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import {
  mockAdminSession,
  mockRequest,
  mockStudentSession,
  mockTeacherSession,
} from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// ---- Mutable "current session" swapped per test. ----
let currentSession: Session = mockAdminSession();

const mockTemplateFindUnique = mock.fn() as any;
const mockResponseFindMany = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

// withTeacherAuth mirrors production: staff-only (teacher OR admin), which is
// exactly why the route's own gate has to carry the admin/coordinator tier
// check — the wrapper lets a plain teacher through.
mock.module("@/lib/api-error", {
  namedExports: {
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
    withTeacherAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: Session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        try {
          if (currentSession.role !== "teacher" && currentSession.role !== "admin") {
            throw makeHttpError(403, "Forbidden");
          }
          return await handler(currentSession, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
    forbidden: (message = "Forbidden") => makeHttpError(403, message),
    badRequest: (message: string) => makeHttpError(400, message),
    notFound: (message = "Not found") => makeHttpError(404, message),
  },
});

// NOTE: @/lib/classroom is deliberately NOT mocked. The predicate under test
// is the production one — a mock that re-states the intended answer would
// pass even while the route calls the wrong predicate, which is how this bug
// stayed invisible.
mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      formTemplate: { findUnique: mockTemplateFindUnique },
      formResponse: { findMany: mockResponseFindMany },
    },
    prismaAdmin: {},
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
    tryLogAuditEvent: async (input: unknown) => {
      await mockLogAuditEvent(input);
      return { audited: true };
    },
  },
});

const TEMPLATE_SCHEMA = [
  { key: "goal", label: "Goal", required: true, type: "text" },
];

function responseRow(id: string) {
  return {
    id,
    status: "submitted",
    answers: { goal: "Get a CDL" },
    submittedAt: new Date("2026-09-01T00:00:00Z"),
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    student: {
      id: "stu-1",
      studentId: "jdoe",
      displayName: "Jane Doe",
      classEnrollments: [
        { class: { id: "class-1", name: "Morning SPOKES", programType: "spokes" } },
      ],
    },
  };
}

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  mockTemplateFindUnique.mock.resetCalls();
  mockResponseFindMany.mock.resetCalls();
  mockLogAuditEvent.mock.resetCalls();

  mockTemplateFindUnique.mock.mockImplementation(async () => ({
    id: "tpl-1",
    title: "SPOKES Intake",
    schema: TEMPLATE_SCHEMA,
    isOfficial: true,
  }));
  mockResponseFindMany.mock.mockImplementation(async () => [responseRow("resp-1")]);
  mockLogAuditEvent.mock.mockImplementation(async () => undefined);

  currentSession = mockAdminSession();
});

async function callRoute(): Promise<Response> {
  const req = mockRequest("/api/teacher/forms/tpl-1/export", { method: "GET" });
  return route.GET(req as any, { params: Promise.resolve({ templateId: "tpl-1" }) } as any);
}

describe("GET /api/teacher/forms/:templateId/export — authorization", () => {
  it("refuses a plain teacher session with 403 and reads no responses", async () => {
    currentSession = mockTeacherSession();
    const res = await callRoute();
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.match(String(json.error), /admin/i);
    assert.equal(
      mockResponseFindMany.mock.callCount(),
      0,
      "a refused export must never reach the response table",
    );
    assert.equal(mockTemplateFindUnique.mock.callCount(), 0);
  });

  it("refuses a student session with 403", async () => {
    currentSession = mockStudentSession();
    const res = await callRoute();
    assert.equal(res.status, 403);
    assert.equal(mockResponseFindMany.mock.callCount(), 0);
  });

  it("lets an admin export and scopes the query to managed students", async () => {
    const res = await callRoute();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "text/csv; charset=utf-8");

    const body = await res.text();
    assert.match(body, /Jane Doe/);

    assert.equal(mockResponseFindMany.mock.callCount(), 1);
    const where = mockResponseFindMany.mock.calls[0].arguments[0].where as Record<string, unknown>;
    assert.equal(where.templateId, "tpl-1");
    assert.deepEqual(where.status, { not: "draft" });
    // App-layer scope must agree with what RLS would allow: the query is
    // narrowed through the same managed-student clause every other staff
    // read uses, not left unscoped on the belief that only admins get here.
    assert.ok(where.student, "formResponse.findMany must carry a student scope");
    assert.deepEqual(where.student, { role: "student" });
  });

  it("records exactly one audit event carrying the template id and row count", async () => {
    const res = await callRoute();
    await res.text();

    assert.equal(mockLogAuditEvent.mock.callCount(), 1);
    const input = mockLogAuditEvent.mock.calls[0].arguments[0] as Record<string, any>;
    assert.equal(input.action, "teacher.form.export");
    assert.equal(input.targetType, "form_template");
    assert.equal(input.targetId, "tpl-1");
    assert.equal(input.actorId, "adm-test-001");
    assert.equal(input.actorRole, "admin");
    assert.equal(input.metadata.rowCount, 1);

    // Audit payloads carry no student PII (.claude/rules/security.md).
    const serialized = JSON.stringify(input);
    assert.ok(!serialized.includes("stu-1"), `audit payload leaked a student id: ${serialized}`);
    assert.ok(!serialized.includes("Jane Doe"), `audit payload leaked a student name: ${serialized}`);
  });

  it("404s an unknown template before touching responses", async () => {
    mockTemplateFindUnique.mock.mockImplementation(async () => null);
    const res = await callRoute();
    assert.equal(res.status, 404);
    assert.equal(mockResponseFindMany.mock.callCount(), 0);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0);
  });
});
