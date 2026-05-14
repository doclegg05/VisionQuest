import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeAgentTool } from "./executor";
import type { Session } from "@/lib/api-error";

const studentSession: Session = {
  id: "student-1",
  studentId: "student-1",
  displayName: "Student One",
  role: "student",
};

describe("executeAgentTool", () => {
  it("rejects malformed model tool arguments before executing the tool", async () => {
    const record = await executeAgentTool({
      session: studentSession,
      conversationId: "conversation-1",
      toolName: "open_resource",
      args: {
        resourceId: "goals",
        unexpectedWrite: true,
      },
    });

    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /Tool call rejected before execution/);
    assert.match(record.result.summary, /Unsupported argument "unexpectedWrite"/);
    assert.match(record.result.modelHint ?? "", /did not match the declared schema/);
  });

  it("rejects invalid enum values before executing the tool", async () => {
    const record = await executeAgentTool({
      session: studentSession,
      conversationId: "conversation-1",
      toolName: "open_resource",
      args: {
        resourceId: "settings",
      },
    });

    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /resourceId must be one of/);
  });
});
