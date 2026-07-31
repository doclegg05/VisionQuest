import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { raiseCrisisAlertIfSignalled } from "./crisis-alert";
import type { CrisisCategory } from "@/lib/sage/crisis-detection";

// ---------------------------------------------------------------------------
// VQ-R-001 — the crisis scan and staff alert must not depend on a successful
// model stream.
//
// Before this fix the only caller of detectCrisisSignal on the chat path was
// handlePostResponse, reached at src/app/api/chat/send/route.ts:1020 — inside
// the try block that runs *after* streaming completes. A provider 503, a
// mid-stream model error, or a student closing the tab therefore saved a
// message containing explicit suicidal intent and raised no alert at all,
// while post-response.ts's own header claimed the scan "always runs first,
// unconditionally; no cap, flag, or provider outage can ever suppress it".
//
// This module is that claim made true: one deterministic, never-throwing
// helper that both the early route hook and handlePostResponse call.
// ---------------------------------------------------------------------------

type RecordCall = {
  studentId: string;
  conversationId: string | null;
  reason: string;
  category: CrisisCategory | null;
};

function harness(
  opts: { matched: boolean; category?: CrisisCategory; recordThrows?: boolean } = { matched: false },
) {
  const calls: RecordCall[] = [];
  const detected: string[] = [];
  return {
    calls,
    detected,
    detect: (text: string) => {
      detected.push(text);
      return { matched: opts.matched, category: opts.category ?? null };
    },
    record: async (args: RecordCall) => {
      if (opts.recordThrows) throw new Error("prisma exploded");
      calls.push(args);
    },
  };
}

describe("raiseCrisisAlertIfSignalled (VQ-R-001)", () => {
  it("raises a staff alert for a student crisis message", async () => {
    const h = harness({ matched: true, category: "self_harm" });

    const raised = await raiseCrisisAlertIfSignalled({
      userMessage: "i dont want to be here anymore",
      studentId: "stu_1",
      conversationId: "conv_1",
      isStaffChat: false,
      detect: h.detect,
      record: h.record,
    });

    assert.equal(raised, true);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0], {
      studentId: "stu_1",
      conversationId: "conv_1",
      reason: "message_signal",
      category: "self_harm",
    });
  });

  it("passes the category only — never the message text", async () => {
    const secret = "i took all my pills at 4pm in the kitchen";
    const h = harness({ matched: true, category: "self_harm" });

    await raiseCrisisAlertIfSignalled({
      userMessage: secret,
      studentId: "stu_1",
      conversationId: "conv_1",
      isStaffChat: false,
      detect: h.detect,
      record: h.record,
    });

    const serialized = JSON.stringify(h.calls[0]);
    assert.ok(
      !serialized.includes("pills") && !serialized.includes("kitchen"),
      "the alert payload must never carry message text",
    );
  });

  it("does not alert on staff chat — a teacher describing a student is not the subject", async () => {
    const h = harness({ matched: true, category: "self_harm" });

    const raised = await raiseCrisisAlertIfSignalled({
      userMessage: "the student said he wants to die",
      studentId: "teacher_1",
      conversationId: "conv_1",
      isStaffChat: true,
      detect: h.detect,
      record: h.record,
    });

    assert.equal(raised, false);
    assert.equal(h.calls.length, 0, "no alert may be raised for a staff turn");
    assert.equal(h.detected.length, 0, "staff turns should not even be scanned");
  });

  it("does not alert when nothing matched", async () => {
    const h = harness({ matched: false });

    const raised = await raiseCrisisAlertIfSignalled({
      userMessage: "when is the ged class",
      studentId: "stu_1",
      conversationId: "conv_1",
      isStaffChat: false,
      detect: h.detect,
      record: h.record,
    });

    assert.equal(raised, false);
    assert.equal(h.calls.length, 0);
  });

  it("never throws when the recorder fails — the caller is fire-and-forget", async () => {
    const h = harness({ matched: true, category: "self_harm", recordThrows: true });

    const raised = await raiseCrisisAlertIfSignalled({
      userMessage: "i want to die",
      studentId: "stu_1",
      conversationId: null,
      isStaffChat: false,
      detect: h.detect,
      record: h.record,
    });

    assert.equal(raised, false, "a failed record must report false, not reject");
  });

  it("tolerates a null conversationId, so it can run before the conversation exists", async () => {
    const h = harness({ matched: true, category: "self_harm" });

    const raised = await raiseCrisisAlertIfSignalled({
      userMessage: "i want to die",
      studentId: "stu_1",
      conversationId: null,
      isStaffChat: false,
      detect: h.detect,
      record: h.record,
    });

    assert.equal(raised, true);
    assert.equal(h.calls[0].conversationId, null);
  });
});
