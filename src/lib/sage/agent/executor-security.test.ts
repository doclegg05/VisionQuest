import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import type { AgentTool } from "./types";

const secret = "private student note / database credential";
const execute = mock.fn(async (_args: Record<string, unknown>, _context: Parameters<AgentTool["execute"]>[1]) => ({ status: "success" as const, summary: secret }));
const checkAccess = mock.fn(async (_session: Session, id: string) => ({ id }));
const rateLimit = mock.fn(async () => ({ allowed: true }));
const audits: unknown[] = [];
const logs: unknown[] = [];
const tool: AgentTool = {
  name: "security_test", description: "Test", enabled: true,
  requiredRoles: ["student", "teacher"], riskTier: "read",
  parameters: { type: "object", properties: { note: { type: "string" } } },
  execute,
};
mock.module("./tools", { namedExports: { getToolByName: () => tool, findToolBySlashCommand: () => tool } });
mock.module("./flags", { namedExports: { agentMode: () => "full", isTierAllowedInMode: () => true } });
mock.module("./rate-limit", { namedExports: { checkToolRateLimit: rateLimit, rateLimitMessage: () => "Limited" } });
mock.module("@/lib/classroom", { namedExports: { assertStaffCanManageStudent: checkAccess } });
mock.module("@/lib/api-error", { namedExports: { isStaffRole: (role: string) => ["teacher", "admin", "coordinator"].includes(role) } });
mock.module("@/lib/audit", { namedExports: { logAuditEvent: async (event: unknown) => { audits.push(event); } } });
mock.module("@/lib/logger", { namedExports: { logger: { error: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args) } } });

let executeAgentTool: typeof import("./executor").executeAgentTool;
before(async () => { ({ executeAgentTool } = await import("./executor")); });
const session: Session = { id: "actor", studentId: "actor", displayName: "Test", role: "student" };
const options = { session, conversationId: "conversation", toolName: tool.name, args: { note: secret } };
beforeEach(() => {
  execute.mock.resetCalls();
  execute.mock.mockImplementation(async () => ({ status: "success", summary: secret }));
  checkAccess.mock.resetCalls();
  checkAccess.mock.mockImplementation(async (_session, id) => ({ id }));
  rateLimit.mock.resetCalls();
  audits.length = 0;
  logs.length = 0;
});

describe("agent execution security boundary", () => {
  it("rejects a student's target before rate limiting or executing", async () => {
    const result = await executeAgentTool({ ...options, targetStudentId: "other" });
    assert.equal(result.result.status, "error");
    assert.equal(checkAccess.mock.callCount(), 0);
    assert.equal(rateLimit.mock.callCount(), 0);
    assert.equal(execute.mock.callCount(), 0);
  });
  it("rechecks staff access even with a confirmation token", async () => {
    checkAccess.mock.mockImplementation(async () => { throw new Error(secret); });
    const result = await executeAgentTool({ ...options, session: { ...session, role: "teacher" }, targetStudentId: "other", confirmedToken: "previously-issued" });
    assert.equal(result.result.status, "error");
    assert.equal(checkAccess.mock.callCount(), 1);
    assert.equal(execute.mock.callCount(), 0);
    assert.ok(!JSON.stringify(result.result).includes(secret));
  });
  it("does not reuse authorization after staff access is revoked", async () => {
    const staffOptions = { ...options, session: { ...session, role: "teacher" }, targetStudentId: "other" };
    assert.equal((await executeAgentTool(staffOptions)).result.status, "success");
    checkAccess.mock.mockImplementation(async () => { throw new Error("Access revoked"); });
    const confirmed = await executeAgentTool({ ...staffOptions, confirmedToken: "previously-issued" });
    assert.equal(confirmed.result.status, "error");
    assert.equal(execute.mock.callCount(), 1);
    assert.equal(checkAccess.mock.callCount(), 2);
  });
  it("rejects username/primary-key collisions even with a bound token", async () => {
    checkAccess.mock.mockImplementation(async () => ({ id: "different-primary-key" }));
    for (const confirmedToken of [undefined, "previously-issued"]) {
      const result = await executeAgentTool({ ...options, session: { ...session, role: "teacher" }, targetStudentId: "other", confirmedToken });
      assert.equal(result.result.status, "error");
    }
    assert.equal(execute.mock.callCount(), 0);
    assert.equal(rateLimit.mock.callCount(), 0);
  });
  it("allows an authorized staff target", async () => {
    const result = await executeAgentTool({ ...options, session: { ...session, role: "teacher" }, targetStudentId: "other" });
    assert.equal(result.result.status, "success");
    assert.equal(checkAccess.mock.calls[0].arguments[1], "other");
    assert.equal(execute.mock.callCount(), 1);
    assert.equal(execute.mock.calls[0].arguments[1].targetStudentId, "other");
  });
  it("audits metadata without copying tool arguments or result text", async () => {
    await executeAgentTool(options);
    assert.equal(audits.length, 1);
    assert.ok(!JSON.stringify(audits).includes(secret));
    assert.match(JSON.stringify(audits), /sage.tool.security_test/);
  });
  it("does not expose thrown database/provider details to the model or logs", async () => {
    execute.mock.mockImplementation(async () => { throw new Error(secret); });
    const result = await executeAgentTool(options);
    assert.equal(result.result.summary, "Tool failed unexpectedly.");
    assert.ok(!JSON.stringify(logs).includes(secret));
    assert.equal(logs.length, 1);
  });
});
