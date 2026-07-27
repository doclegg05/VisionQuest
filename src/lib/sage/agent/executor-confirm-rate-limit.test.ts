/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
// =============================================================================
// VQ-R-012 — consequential rate limiting must count actions, not legs.
//
// A consequential tool passes through the executor twice per action: the
// proposal leg (returns the HMAC confirmation card) and the confirmed leg
// (/api/chat/tool-confirm re-enters with confirmedToken). The old code
// consumed a unit on BOTH legs, halving the real budget — and the block could
// land on the confirm leg, after the student already clicked approve.
//
// Contract under test:
//   - proposal leg: peek only (no consumption); may block.
//   - confirmed leg: never blocked on quota; consumes exactly one unit, and
//     only after the tool actually executed successfully.
//   - read/reversible tiers: unchanged single-leg consume.
// =============================================================================
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";
process.env.SAGE_AGENT_MODE = "full";

let peekAllowed = true;
const peekCalls: string[] = [];
const consumeCalls: string[] = [];
const executionLog: string[] = [];
let consequentialResultStatus: "success" | "error" = "success";

mock.module("./rate-limit", {
  namedExports: {
    peekToolRateLimit: async (_studentId: string, toolName: string) => {
      peekCalls.push(toolName);
      return { allowed: peekAllowed, remaining: peekAllowed ? 1 : 0, resetTime: 1_000, limit: 5, window: "day" };
    },
    checkToolRateLimit: async (_studentId: string, toolName: string) => {
      consumeCalls.push(toolName);
      executionLog.push(`consume:${toolName}`);
      return { allowed: true, remaining: 1, resetTime: 1_000, limit: 5, window: "day" };
    },
    rateLimitMessage: (toolName: string) => `LIMIT:${toolName}`,
  },
});

mock.module("./tools", {
  namedExports: {
    getToolByName: (name: string) => {
      if (name === "fake_consequential") {
        return {
          name: "fake_consequential",
          description: "test consequential tool",
          parameters: { type: "object", properties: {} },
          requiredRoles: [],
          riskTier: "mutate_consequential",
          enabled: true,
          execute: async () => {
            executionLog.push("execute:fake_consequential");
            return { status: consequentialResultStatus, summary: "did the thing" };
          },
        };
      }
      if (name === "fake_read") {
        return {
          name: "fake_read",
          description: "test read tool",
          parameters: { type: "object", properties: {} },
          requiredRoles: [],
          riskTier: "read",
          enabled: true,
          execute: async () => ({ status: "success" as const, summary: "read the thing" }),
        };
      }
      return undefined;
    },
    findToolBySlashCommand: () => undefined,
  },
});

mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: async () => undefined },
});

let executeAgentTool: typeof import("./executor").executeAgentTool;

before(async () => {
  ({ executeAgentTool } = await import("./executor"));
});

const session: Session = {
  id: "student-1",
  studentId: "student-1",
  displayName: "Student One",
  role: "student",
};

beforeEach(() => {
  peekAllowed = true;
  consequentialResultStatus = "success";
  peekCalls.length = 0;
  consumeCalls.length = 0;
  executionLog.length = 0;
});

describe("consequential two-leg rate limiting (VQ-R-012)", () => {
  it("proposal leg peeks without consuming", async () => {
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "fake_consequential",
      args: {},
    });
    assert.equal(record.result.status, "success");
    assert.deepEqual(peekCalls, ["fake_consequential"]);
    assert.equal(consumeCalls.length, 0);
  });

  it("proposal leg blocks when the peek says the budget is spent", async () => {
    peekAllowed = false;
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "fake_consequential",
      args: {},
    });
    assert.equal(record.result.status, "error");
    assert.equal(record.result.summary, "LIMIT:fake_consequential");
    // Blocked before execution, and still nothing consumed.
    assert.equal(executionLog.includes("execute:fake_consequential"), false);
    assert.equal(consumeCalls.length, 0);
  });

  it("confirmed leg never blocks on quota and consumes exactly once, after execution", async () => {
    peekAllowed = false; // even a spent budget must not stop an approved card
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "fake_consequential",
      args: {},
      confirmedToken: "token-1",
    });
    assert.equal(record.result.status, "success");
    assert.equal(peekCalls.length, 0);
    assert.deepEqual(consumeCalls, ["fake_consequential"]);
    // The single unit is recorded only after the action actually ran.
    assert.deepEqual(executionLog, ["execute:fake_consequential", "consume:fake_consequential"]);
  });

  it("confirmed leg does not consume when the tool itself fails", async () => {
    consequentialResultStatus = "error";
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "fake_consequential",
      args: {},
      confirmedToken: "token-1",
    });
    assert.equal(record.result.status, "error");
    assert.equal(consumeCalls.length, 0);
  });

  it("read-tier tools keep the single-leg consume", async () => {
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "fake_read",
      args: {},
    });
    assert.equal(record.result.status, "success");
    assert.equal(peekCalls.length, 0);
    assert.deepEqual(consumeCalls, ["fake_read"]);
  });
});
