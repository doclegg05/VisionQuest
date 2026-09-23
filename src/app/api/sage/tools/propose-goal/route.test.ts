import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { NextRequest } from "next/server";

const studentId = "student-a";
const sourceId = "cjld2cjxh0000qzrmn831i7rn";
const conversationId = "cjld2cjxh0001qzrmn831i7rn";
const parentId = "cjld2cjxh0002qzrmn831i7rn";
let sourceOwner = studentId;
let sourceRole = "assistant";
let parentOwner = studentId;
const proposals: Record<string, unknown>[] = [];
const wagers: unknown[] = [];
function badRequest(message: string) { return Object.assign(new Error(message), { statusCode: 400 }); }
mock.module("@/lib/api-error", { namedExports: { badRequest, rateLimited: badRequest } });
mock.module("@/lib/registry/middleware", { namedExports: {
  withRegistry: (_name: string, handler: (session: { id: string }, req: Request) => Promise<Response>) => async (req: Request) => {
    try { return await handler({ id: studentId }, req); }
    catch (error) { return Response.json({ error: (error as Error).message }, { status: (error as { statusCode?: number }).statusCode ?? 500 }); }
  },
} });
mock.module("@/lib/schemas", { namedExports: {
  parseBody: async (req: Request, schema: { parse: (body: unknown) => unknown }) => schema.parse(await req.json()),
} });
mock.module("@/lib/rate-limit", { namedExports: { rateLimit: async () => ({ success: true }) } });
mock.module("@/lib/db", { namedExports: { prisma: {
  message: { findFirst: async ({ where }: { where: { id: string; role: string; conversation: { studentId: string; id?: string } } }) => {
    assert.equal(where.id, sourceId);
    return where.conversation?.studentId === sourceOwner && where.role === sourceRole && (!where.conversation.id || where.conversation.id === conversationId)
      ? { conversationId } : null;
  } },
  goal: { findFirst: async ({ where }: { where: { id: string; studentId: string } }) => {
    assert.equal(where.id, parentId);
    return where.studentId === parentOwner ? { id: parentId } : null;
  } },
} } });
mock.module("@/lib/sage/propose-goal", { namedExports: { proposeGoal: async (input: Record<string, unknown>) => {
  proposals.push(input); return { status: "created", goalId: "goal" };
} } });
mock.module("@/lib/sage/propose-goal-wager", { namedExports: { maybeCreateGoalProposalWager: async (...args: unknown[]) => { wagers.push(args); } } });
let route: typeof import("./route");
before(async () => { route = await import("./route"); });
beforeEach(() => { sourceOwner = studentId; sourceRole = "assistant"; parentOwner = studentId; proposals.length = 0; wagers.length = 0; });
function request(extra: Record<string, unknown> = {}): NextRequest {
  return new Request("http://localhost/api/sage/tools/propose-goal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level: "weekly", content: "Practice", sourceMessageId: sourceId, ...extra }),
  }) as NextRequest;
}
async function assertRejected(extra: Record<string, unknown> = {}) {
  const response = await route.POST(request(extra), { params: Promise.resolve({}) });
  assert.equal(response.status, 400);
  assert.equal(proposals.length, 0);
  assert.equal(wagers.length, 0);
}
describe("goal proposal reference ownership", () => {
  it("rejects another student's source message", async () => { sourceOwner = "other"; await assertRejected(); });
  it("rejects a user message as Sage provenance", async () => { sourceRole = "user"; await assertRejected(); });
  it("rejects a conversation not containing the source", async () => { await assertRejected({ conversationId: parentId }); });
  it("rejects another student's parent goal", async () => { parentOwner = "other"; await assertRejected({ parentId }); });
  it("accepts owned references and derives the conversation from the source", async () => {
    const response = await route.POST(request({ parentId }), { params: Promise.resolve({}) });
    assert.equal(response.status, 200);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].studentId, studentId);
    assert.equal(proposals[0].conversationId, conversationId);
    assert.equal(proposals[0].parentId, parentId);
    assert.equal(wagers.length, 1);
  });
});
