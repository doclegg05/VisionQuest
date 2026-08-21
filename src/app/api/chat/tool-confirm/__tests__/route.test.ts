/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockTeacherSession, mockRequest } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Request-level tests for POST /api/chat/tool-confirm.
//
// The token crypto (confirmation.ts) runs REAL — these tests sign tokens with
// a test JWT_SECRET and replay genuine requests, so they cover the verify →
// claim → execute ordering end to end. The claim store is an in-memory fake
// of prismaAdmin.sageConfirmationUse whose create() throws the same
// duck-typed { code: "P2002" } a real unique violation produces.
//
// The replay cases are the reason this file exists: a verified confirm token
// must authorize exactly ONE execution. Written first and observed failing
// against the pre-claim route (replay returned 200 and executed twice).
// ---------------------------------------------------------------------------

process.env.JWT_SECRET = "test-secret-for-tool-confirm-route";

const CONVERSATION_ID = "cjld2cjxh0000qzrmn831i7rn";

let session: Session = mockStudentSession();

const mockExecuteAgentTool = mock.fn() as any;

/** In-memory stand-in for the SageConfirmationUse table. */
const claimRows = new Map<string, { expiresAt: Date }>();
let createOverride: (() => Promise<never>) | null = null;
const mockClaimCreate = mock.fn(async ({ data }: any) => {
  if (createOverride) return createOverride();
  if (claimRows.has(data.tokenHash)) {
    const err = new Error("Unique constraint failed") as Error & { code: string };
    err.code = "P2002";
    throw err;
  }
  claimRows.set(data.tokenHash, { expiresAt: data.expiresAt });
  return { ...data };
}) as any;
const mockClaimDeleteMany = mock.fn(async () => ({ count: 0 })) as any;

mock.module("@/lib/api-error", {
  namedExports: {
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
    badRequest: (msg: string) => {
      const e = new Error(msg) as Error & { statusCode: number };
      e.statusCode = 400;
      e.name = "ApiError";
      return e;
    },
    withAuth:
      (handler: (s: Session, req: Request) => Promise<Response>) =>
      async (req: Request) => {
        try {
          return await handler(session, req);
        } catch (e) {
          const err = e as Error & { statusCode?: number };
          return Response.json({ error: err.message }, { status: err.statusCode ?? 500 });
        }
      },
  },
});

mock.module("@/lib/sage/agent/executor", {
  namedExports: {
    executeAgentTool: mockExecuteAgentTool,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {},
    prismaAdmin: {
      sageConfirmationUse: {
        create: mockClaimCreate,
        deleteMany: mockClaimDeleteMany,
      },
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { error: mock.fn(), warn: mock.fn(), info: mock.fn() },
  },
});

let route: { POST: (req: Request) => Promise<Response> };
let createConfirmationToken: (
  payload: {
    toolName: string;
    args: Record<string, unknown>;
    sessionId: string;
    conversationId: string;
    targetStudentId?: string;
  },
  clock: Date,
) => string;

before(async () => {
  ({ createConfirmationToken } = await import("@/lib/sage/agent/confirmation"));
  route = await import("../route");
});

function successRecord() {
  return {
    callId: "call-1",
    tool: "update_goal_status",
    args: {},
    result: { status: "success", summary: "Done." },
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

function confirmRequest(body: Record<string, unknown>): Request {
  return mockRequest("/api/chat/tool-confirm", { method: "POST", body });
}

function signedBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const args = { goalId: "cjld2cjxh0001qzrmn831i7rn", status: "completed" };
  const token = createConfirmationToken(
    {
      toolName: "update_goal_status",
      args,
      sessionId: session.id,
      conversationId: CONVERSATION_ID,
      targetStudentId: undefined,
    },
    new Date(),
  );
  return { toolName: "update_goal_status", args, token, conversationId: CONVERSATION_ID, ...overrides };
}

describe("POST /api/chat/tool-confirm", () => {
  beforeEach(() => {
    session = mockStudentSession();
    claimRows.clear();
    createOverride = null;
    mockExecuteAgentTool.mock.resetCalls();
    mockClaimCreate.mock.resetCalls();
    mockClaimDeleteMany.mock.resetCalls();
    mockExecuteAgentTool.mock.mockImplementation(async () => successRecord());
  });

  it("executes a validly-confirmed tool call once", async () => {
    const res = await route.POST(confirmRequest(signedBody()));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(mockExecuteAgentTool.mock.callCount(), 1);
    const call = mockExecuteAgentTool.mock.calls[0].arguments[0];
    assert.equal(call.toolName, "update_goal_status");
    assert.equal(call.session, session);
  });

  it("refuses a replayed confirmation and does not execute twice", async () => {
    const body = signedBody();

    const first = await route.POST(confirmRequest(body));
    assert.equal(first.status, 200);

    const replay = await route.POST(confirmRequest(body));
    assert.equal(replay.status, 400);
    const json = await replay.json();
    assert.match(json.error, /already used/i);
    assert.equal(mockExecuteAgentTool.mock.callCount(), 1);
  });

  it("burns the claim even when the tool execution fails", async () => {
    // Releasing the claim on a failed execution would re-open replay exactly
    // when a partial write may have happened — the policy is one attempt per
    // token, so a failure means asking Sage for a fresh card.
    mockExecuteAgentTool.mock.mockImplementation(async () => ({
      ...successRecord(),
      result: { status: "error", summary: "Tool failed unexpectedly." },
    }));
    const body = signedBody();

    const first = await route.POST(confirmRequest(body));
    assert.equal(first.status, 200);
    assert.equal((await first.json()).success, false);

    const replay = await route.POST(confirmRequest(body));
    assert.equal(replay.status, 400);
    assert.equal(mockExecuteAgentTool.mock.callCount(), 1);
  });

  it("never claims or executes on an invalid token", async () => {
    // Verification stays FIRST: unverified garbage must not write claim rows
    // (which would hand unauthenticated payload-tamperers a DB write) and
    // must not reach the executor.
    const body = signedBody();
    const tampered = { ...body, args: { goalId: "cjld2cjxh0001qzrmn831i7rn", status: "paused" } };

    const res = await route.POST(confirmRequest(tampered));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /expired or is invalid/i);
    assert.equal(mockClaimCreate.mock.callCount(), 0);
    assert.equal(mockExecuteAgentTool.mock.callCount(), 0);
  });

  it("fails closed when the claim store is unavailable", async () => {
    createOverride = async () => {
      const err = new Error("Unable to start a transaction") as Error & { code: string };
      err.code = "P2028";
      throw err;
    };

    const res = await route.POST(confirmRequest(signedBody()));
    assert.equal(res.status, 500);
    assert.equal(mockExecuteAgentTool.mock.callCount(), 0);
  });

  it("still rejects a student sending targetStudentId before touching the claim store", async () => {
    session = mockStudentSession();
    const res = await route.POST(
      confirmRequest(signedBody({ targetStudentId: "cjld2cjxh0002qzrmn831i7rn" })),
    );
    assert.equal(res.status, 400);
    assert.equal(mockClaimCreate.mock.callCount(), 0);
    assert.equal(mockExecuteAgentTool.mock.callCount(), 0);
  });

  it("lets staff confirm a staff-targeted proposal exactly once", async () => {
    session = mockTeacherSession();
    const targetStudentId = "cjld2cjxh0002qzrmn831i7rn";
    const args = { formId: "spokes-profile" };
    const token = createConfirmationToken(
      {
        toolName: "update_goal_status",
        args,
        sessionId: session.id,
        conversationId: CONVERSATION_ID,
        targetStudentId,
      },
      new Date(),
    );
    const body = {
      toolName: "update_goal_status",
      args,
      token,
      conversationId: CONVERSATION_ID,
      targetStudentId,
    };

    const first = await route.POST(confirmRequest(body));
    assert.equal(first.status, 200);
    const replay = await route.POST(confirmRequest(body));
    assert.equal(replay.status, 400);
    assert.equal(mockExecuteAgentTool.mock.callCount(), 1);
  });
});
