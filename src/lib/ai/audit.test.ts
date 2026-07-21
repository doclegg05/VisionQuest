import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { SAGE_PROMPT_REVISION } from "@/lib/sage/prompt-revision";
import type { AiAuditEventInput } from "./audit";

const mockLogAuditEvent = mock.fn(async () => undefined);

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

let logAiAuditEvent: typeof import("./audit").logAiAuditEvent;

before(async () => {
  ({ logAiAuditEvent } = await import("./audit"));
});

beforeEach(() => {
  mockLogAuditEvent.mock.resetCalls();
});

interface CapturedAuditEvent {
  action: string;
  metadata: Record<string, unknown>;
}

function capturedEvents(): CapturedAuditEvent[] {
  return mockLogAuditEvent.mock.calls.map(
    (call: { arguments: unknown[] }) => call.arguments[0] as CapturedAuditEvent,
  );
}

function baseInput(overrides: Partial<AiAuditEventInput> = {}): AiAuditEventInput {
  return {
    actorId: "student-1",
    actorRole: "student",
    route: "/api/chat/send",
    task: "sage_student_chat",
    sensitivity: "student_record",
    policyDecision: "configured_provider",
    status: "completed",
    providerName: "gemini",
    allowCloud: true,
    ...overrides,
  };
}

describe("logAiAuditEvent", () => {
  it("stamps the current Sage prompt revision into event metadata by default", async () => {
    await logAiAuditEvent(baseInput());

    assert.equal(mockLogAuditEvent.mock.callCount(), 1);
    const [event] = capturedEvents();
    assert.equal(event.action, "ai.request.completed");
    assert.equal(event.metadata.promptRevision, SAGE_PROMPT_REVISION);
  });

  it("uses input.promptRevision to override the stamped revision when provided", async () => {
    await logAiAuditEvent(baseInput({ promptRevision: "2099-01-01.experiment" }));

    assert.equal(mockLogAuditEvent.mock.callCount(), 1);
    assert.equal(capturedEvents()[0].metadata.promptRevision, "2099-01-01.experiment");
  });

  it("keeps the revision stamp on blocked events too, so regressions stay attributable", async () => {
    await logAiAuditEvent(baseInput({ status: "blocked", reason: "cloud disallowed" }));

    const [event] = capturedEvents();
    assert.equal(event.action, "ai.request.blocked");
    assert.equal(event.metadata.promptRevision, SAGE_PROMPT_REVISION);
  });
});
