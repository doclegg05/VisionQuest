import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCacheableSystemPrompt, buildSystemPrompt } from "./system-prompts";

test("different students and questions share only trusted static instructions", () => {
  const a = buildCacheableSystemPrompt("discovery", { studentName: "Synthetic A", userMessage: "Interview tips", student_status_summary: "Form pending review" }, "compact");
  const b = buildCacheableSystemPrompt("discovery", { studentName: "Synthetic B", userMessage: "Help with transportation", student_status_summary: "Orientation incomplete" }, "compact");
  assert.equal(a.text.slice(0, a.systemPrefixLength), b.text.slice(0, b.systemPrefixLength));
  assert.ok(a.systemPrefixLength > 1000);
  assert.ok(!a.text.slice(0, a.systemPrefixLength).includes("Synthetic A"));
  assert.ok(a.text.slice(a.systemPrefixLength).includes("Synthetic A"));
  assert.ok(a.text.slice(a.systemPrefixLength).includes("Form pending review"));
  assert.ok(!b.text.includes("Synthetic A"));
});

for (const stage of ["discovery", "onboarding", "daily", "teacher_assistant", "admin_assistant", "coordinator_assistant"] as const) {
  test(`cache layout preserves every ${stage} section without duplication or omission`, () => {
    const context = { studentName: "Synthetic A", bhag: "Work in healthcare", daily: "Practice an interview", userMessage: "What is the dress code?", staffStudentContext: "Authorized synthetic student context", discovery_summary: "Enjoys helping people" };
    const original = buildSystemPrompt(stage, context, "compact");
    const cached = buildCacheableSystemPrompt(stage, context, "compact");
    assert.deepEqual(cached.text.split("\n\n---\n\n").sort(), original.split("\n\n---\n\n").sort());
    assert.ok(cached.text.endsWith(original.slice(original.lastIndexOf("PRIVATE INSTRUCTIONS:"))));
  });
}
