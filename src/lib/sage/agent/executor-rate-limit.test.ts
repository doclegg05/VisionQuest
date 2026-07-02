import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

// Control the rate-limit decision the executor sees, and confirm it enforces
// BEFORE the tool runs. present_form is a read tool that reads only static
// FORMS data — no DB — so a success path here does not touch the database.
let allow = true;
const rateCalls: Array<{ studentId: string; toolName: string; tier: string }> = [];
const auditActions: string[] = [];

mock.module("./rate-limit", {
  namedExports: {
    checkToolRateLimit: async (studentId: string, toolName: string, tier: string) => {
      rateCalls.push({ studentId, toolName, tier });
      return { allowed: allow, remaining: allow ? 1 : 0, resetTime: 1_000, limit: 5, window: "day" };
    },
    rateLimitMessage: (toolName: string) => `LIMIT:${toolName}`,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: async (event: { action: string }) => {
      auditActions.push(event.action);
    },
  },
});

let executeAgentTool: typeof import("./executor").executeAgentTool;

const studentSession: Session = {
  id: "student-1",
  studentId: "student-1",
  displayName: "Student One",
  role: "student",
};

before(async () => {
  ({ executeAgentTool } = await import("./executor"));
});

beforeEach(() => {
  allow = true;
  rateCalls.length = 0;
  auditActions.length = 0;
});

describe("executor rate-limit enforcement", () => {
  it("checks the limit keyed on the acting session id + tool tier", async () => {
    await executeAgentTool({
      session: studentSession,
      conversationId: "conv-1",
      toolName: "present_form",
      args: { query: "dress code" },
    });
    assert.equal(rateCalls.length, 1);
    assert.deepEqual(rateCalls[0], { studentId: "student-1", toolName: "present_form", tier: "read" });
  });

  it("blocks the call and audits a rate_limited event when over limit", async () => {
    allow = false;
    const record = await executeAgentTool({
      session: studentSession,
      conversationId: "conv-1",
      toolName: "present_form",
      args: { query: "dress code" },
    });
    assert.equal(record.result.status, "error");
    assert.equal(record.result.summary, "LIMIT:present_form");
    assert.match(record.result.modelHint ?? "", /rate-limited/);
    assert.ok(
      auditActions.includes("sage.tool.present_form.rate_limited"),
      `expected rate_limited audit, got ${auditActions.join(", ")}`,
    );
  });

  it("does not rate-limit-check when args fail validation (short-circuits earlier)", async () => {
    const record = await executeAgentTool({
      session: studentSession,
      conversationId: "conv-1",
      toolName: "present_form",
      args: { query: "x", unexpected: true },
    });
    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /rejected before execution/);
    assert.equal(rateCalls.length, 0, "validation must reject before the rate-limit check");
  });
});
