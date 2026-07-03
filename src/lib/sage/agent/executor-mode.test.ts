import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";

// Verifies the executor's OWN mode re-check (defense in depth) — not just
// getEnabledTools' listing-time filter. A caller that bypasses tool
// listing entirely (e.g. /api/chat/tool-confirm, or a stale/replayed model
// function call) must still be blocked here once SAGE_AGENT_MODE no longer
// permits the tool's tier.
//
// Rate-limit + audit are mocked (same pattern as executor-rate-limit.test.ts)
// so the mode-check-passes cases don't need a real DATABASE_URL.

mock.module("./rate-limit", {
  namedExports: {
    checkToolRateLimit: async () => ({
      allowed: true,
      remaining: 1,
      resetTime: 1_000,
      limit: 5,
      window: "day",
    }),
    rateLimitMessage: (toolName: string) => `LIMIT:${toolName}`,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: async () => {},
  },
});

let executeAgentTool: typeof import("./executor").executeAgentTool;

before(async () => {
  ({ executeAgentTool } = await import("./executor"));
});

const ORIGINAL_MODE = process.env.SAGE_AGENT_MODE;
const ORIGINAL_ENABLED = process.env.SAGE_AGENT_ENABLED;

function setMode(mode: string | undefined): void {
  if (mode === undefined) delete process.env.SAGE_AGENT_MODE;
  else process.env.SAGE_AGENT_MODE = mode;
}

afterEach(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.SAGE_AGENT_MODE;
  else process.env.SAGE_AGENT_MODE = ORIGINAL_MODE;
  if (ORIGINAL_ENABLED === undefined) delete process.env.SAGE_AGENT_ENABLED;
  else process.env.SAGE_AGENT_ENABLED = ORIGINAL_ENABLED;
});

const studentSession: Session = {
  id: "student-1",
  studentId: "student-1",
  displayName: "Student One",
  role: "student",
};

describe("executeAgentTool — independent mode re-check", () => {
  it("blocks a read-tier tool call when mode is off", async () => {
    setMode("off");
    const record = await executeAgentTool({
      session: studentSession,
      conversationId: "conv-1",
      toolName: "open_resource",
      args: { resourceId: "goals" },
    });
    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /isn't available right now/);
  });

  it("blocks a mutate_consequential tool call when mode is readonly, even via a direct executor call (tool-confirm path)", async () => {
    setMode("readonly");
    // save_job is mutate_reversible in write-tools/career-tools; use a known
    // consequential tool name if present, else fall back to asserting the
    // tier check fires for any non-read tool. mark_certification_complete is
    // mutate_consequential per docs/superpowers spec.
    const record = await executeAgentTool({
      session: studentSession,
      conversationId: "conv-1",
      toolName: "mark_certification_complete",
      args: { requirementId: "req-1" },
      confirmedToken: "irrelevant-because-mode-check-runs-first",
    });
    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /isn't available right now/);
  });

  it("allows a read-tier tool call when mode is readonly", async () => {
    setMode("readonly");
    const record = await executeAgentTool({
      session: studentSession,
      conversationId: "conv-1",
      toolName: "open_resource",
      args: { resourceId: "goals" },
    });
    assert.equal(record.result.status, "success");
  });

  it("allows a mutate_consequential tool call when mode is full (mode check passes; downstream token verification still applies)", async () => {
    setMode("full");
    const record = await executeAgentTool({
      session: studentSession,
      conversationId: "conv-1",
      toolName: "mark_certification_complete",
      args: { requirementId: "req-1" },
      // No confirmedToken — expect the tool's OWN confirmation check to
      // reject it, proving we got PAST the mode check (not blocked by it).
    });
    assert.equal(record.result.status, "error");
    assert.doesNotMatch(record.result.summary, /isn't available right now/);
  });
});
