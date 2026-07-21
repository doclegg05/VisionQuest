/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const ROW_ID = "cktest0000000000000000000";

class MockApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

const mockFindUnique = mock.fn(async () => null) as any;
const mockUpdate = mock.fn(async () => ({})) as any;
const mockAssertStaffCanManageStudent = mock.fn(async () => ({ id: "stu-1" })) as any;
const mockLogAuditEvent = mock.fn(async () => undefined) as any;
const mockResolveAiProvider = mock.fn(async () => ({ name: "fake" })) as any;
const mockExtractGoals = mock.fn(async () => ({ goals_found: [], stage_complete: false })) as any;
const mockProposeGoal = mock.fn(async () => ({ status: "created", goalId: "g-1" })) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: { failedExtraction: { findUnique: mockFindUnique, update: mockUpdate } },
  },
});
mock.module("@/lib/classroom", {
  namedExports: { assertStaffCanManageStudent: mockAssertStaffCanManageStudent },
});
mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: mockLogAuditEvent },
});
mock.module("@/lib/ai", {
  namedExports: { resolveAiProvider: mockResolveAiProvider },
});
mock.module("@/lib/sage/goal-extractor", {
  namedExports: { extractGoals: mockExtractGoals },
});
mock.module("@/lib/sage/propose-goal", {
  namedExports: { proposeGoal: mockProposeGoal },
});
mock.module("@/lib/api-error", {
  namedExports: {
    withTeacherAuth:
      (handler: (...args: unknown[]) => Promise<Response>) =>
      async (...args: unknown[]) => {
        try {
          return await handler({ id: "teacher-1", role: "teacher" }, ...args);
        } catch (err: unknown) {
          // Generic statusCode check so both MockApiError and any real
          // ApiError (e.g. thrown by the unmocked parseBody chain) map to
          // their HTTP status.
          const statusCode = (err as { statusCode?: unknown })?.statusCode;
          const status = typeof statusCode === "number" ? statusCode : 500;
          const message = err instanceof Error ? err.message : "error";
          return new Response(JSON.stringify({ error: message }), { status });
        }
      },
    badRequest: (msg: string) => new MockApiError(400, msg),
    notFound: (msg = "Not found") => new MockApiError(404, msg),
    conflict: (msg: string) => new MockApiError(409, msg),
    forbidden: (msg = "Forbidden") => new MockApiError(403, msg),
    unauthorized: (msg = "Unauthorized") => new MockApiError(401, msg),
  },
});

let POST: typeof import("./route").POST;

before(async () => {
  ({ POST } = await import("./route"));
});

const params = Promise.resolve({ id: ROW_ID });

const goalSnapshot = JSON.stringify({
  v: 1,
  stage: "goal-setting",
  programType: "adult_ed",
  messages: [
    { role: "user", content: "I want to pass the RLA subtest" },
    { role: "model", content: "Let's make that a weekly goal." },
  ],
});

const openGoalRow = {
  id: ROW_ID,
  studentId: "stu-1",
  conversationId: "conv-1",
  sourceMessageId: "msg-1",
  extractorKey: "goal_extraction",
  payload: goalSnapshot,
  status: "open",
};

function makeRequest(action: string): Request {
  return new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

beforeEach(() => {
  mockFindUnique.mock.resetCalls();
  mockUpdate.mock.resetCalls();
  mockAssertStaffCanManageStudent.mock.resetCalls();
  mockLogAuditEvent.mock.resetCalls();
  mockResolveAiProvider.mock.resetCalls();
  mockExtractGoals.mock.resetCalls();
  mockProposeGoal.mock.resetCalls();
  mockFindUnique.mock.mockImplementation(async () => ({ ...openGoalRow }));
  mockAssertStaffCanManageStudent.mock.mockImplementation(async () => ({ id: "stu-1" }));
  mockExtractGoals.mock.mockImplementation(async () => ({
    goals_found: [{ level: "weekly", content: "Pass an RLA practice test", confidence: 0.9 }],
    stage_complete: false,
  }));
});

describe("POST /api/teacher/failed-extractions/[id] — dismiss", () => {
  it("marks the row dismissed with resolver stamps and audits it", async () => {
    const res = (await POST(makeRequest("dismiss"), { params })) as Response;
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.status, "dismissed");

    const updateArgs = mockUpdate.mock.calls[0].arguments[0];
    assert.equal(updateArgs.where.id, ROW_ID);
    assert.equal(updateArgs.data.status, "dismissed");
    assert.equal(updateArgs.data.resolvedBy, "teacher-1");
    assert.ok(updateArgs.data.resolvedAt instanceof Date);

    const audit = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(audit.action, "teacher.failed_extraction.dismiss");
    assert.equal(audit.targetId, ROW_ID);
    assert.equal(audit.metadata.studentId, "stu-1");
  });
});

describe("POST /api/teacher/failed-extractions/[id] — replay", () => {
  it("re-runs extractGoals on the stored snapshot and proposes via proposeGoal", async () => {
    const res = (await POST(makeRequest("replay"), { params })) as Response;
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.status, "replayed");
    assert.equal(body.data.created, 1);

    // Provider resolved for the STUDENT's record sensitivity, not the teacher's.
    const providerReq = mockResolveAiProvider.mock.calls[0].arguments[0];
    assert.equal(providerReq.studentId, "stu-1");
    assert.equal(providerReq.sensitivity, "student_record");

    // extractGoals fed from the parsed snapshot.
    const [, messages, stage, programType] = mockExtractGoals.mock.calls[0].arguments;
    assert.equal(messages.length, 2);
    assert.equal(stage, "goal-setting");
    assert.equal(programType, "adult_ed");

    // proposeGoal reuses the stored sourceMessageId and stamps the teacher.
    const proposal = mockProposeGoal.mock.calls[0].arguments[0];
    assert.equal(proposal.studentId, "stu-1");
    assert.equal(proposal.sourceMessageId, "msg-1");
    assert.equal(proposal.conversationId, "conv-1");
    assert.equal(proposal.invokedBy, "teacher-1");
    assert.equal(proposal.level, "weekly");

    const updateArgs = mockUpdate.mock.calls[0].arguments[0];
    assert.equal(updateArgs.data.status, "replayed");
    assert.equal(updateArgs.data.resolvedBy, "teacher-1");

    const audit = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(audit.action, "teacher.failed_extraction.replay");
  });

  it("returns 400 for non-goal extractors (manual-first, no generic replay)", async () => {
    mockFindUnique.mock.mockImplementationOnce(async () => ({
      ...openGoalRow,
      extractorKey: "mood_extraction_exhausted",
    }));

    const res = (await POST(makeRequest("replay"), { params })) as Response;
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.match(body.error, /replay not supported for this extractor yet/);
    assert.equal(mockUpdate.mock.callCount(), 0);
    assert.equal(mockResolveAiProvider.mock.callCount(), 0);
  });

  it("returns 400 when the stored payload is not a replayable snapshot", async () => {
    mockFindUnique.mock.mockImplementationOnce(async () => ({
      ...openGoalRow,
      payload: "not json at all",
    }));

    const res = (await POST(makeRequest("replay"), { params })) as Response;

    assert.equal(res.status, 400);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("returns 400 when the original sourceMessageId was never captured", async () => {
    mockFindUnique.mock.mockImplementationOnce(async () => ({
      ...openGoalRow,
      sourceMessageId: null,
    }));

    const res = (await POST(makeRequest("replay"), { params })) as Response;

    assert.equal(res.status, 400);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });
});

describe("POST /api/teacher/failed-extractions/[id] — guards", () => {
  it("404s on unknown rows", async () => {
    mockFindUnique.mock.mockImplementationOnce(async () => null);

    const res = (await POST(makeRequest("dismiss"), { params })) as Response;
    assert.equal(res.status, 404);
  });

  it("409s when the row was already resolved", async () => {
    mockFindUnique.mock.mockImplementationOnce(async () => ({ ...openGoalRow, status: "dismissed" }));

    const res = (await POST(makeRequest("dismiss"), { params })) as Response;
    assert.equal(res.status, 409);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("403s (fail-closed) when the teacher does not manage the student", async () => {
    mockAssertStaffCanManageStudent.mock.mockImplementationOnce(async () => {
      throw new MockApiError(403, "You do not have access to this student.");
    });

    const res = (await POST(makeRequest("dismiss"), { params })) as Response;
    assert.equal(res.status, 403);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("rejects unknown actions with 400", async () => {
    const res = (await POST(makeRequest("retry-everything"), { params })) as Response;
    assert.equal(res.status, 400);
  });

  it("rejects malformed ids with 400", async () => {
    const res = (await POST(makeRequest("dismiss"), {
      params: Promise.resolve({ id: "not-a-cuid!" }),
    })) as Response;
    assert.equal(res.status, 400);
    assert.equal(mockFindUnique.mock.callCount(), 0);
  });
});
