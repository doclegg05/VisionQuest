import test from "node:test";
import assert from "node:assert/strict";
import { validateProposalInput } from "./propose-goal";

test("validateProposalInput: accepts a valid bhag proposal", () => {
  const r = validateProposalInput({
    level: "bhag",
    content: "  Earn IC3 certification by November.  ",
    sourceMessageId: "msg_123",
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.content, "Earn IC3 certification by November.");
});

test("validateProposalInput: rejects empty content", () => {
  const r = validateProposalInput({
    level: "weekly",
    content: "   ",
    sourceMessageId: "msg_123",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /empty/i);
});

test("validateProposalInput: rejects content over 1000 chars", () => {
  const r = validateProposalInput({
    level: "weekly",
    content: "x".repeat(1001),
    sourceMessageId: "msg_123",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /1000/);
});

test("validateProposalInput: rejects unknown level", () => {
  const r = validateProposalInput({
    level: "lifetime",
    content: "Become a senator",
    sourceMessageId: "msg_123",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /invalid level/i);
});

test("validateProposalInput: requires sourceMessageId for traceability", () => {
  const r = validateProposalInput({
    level: "weekly",
    content: "Finish module 3",
    sourceMessageId: "",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /sourceMessageId/i);
});

test("validateProposalInput: accepts all five recognized levels", () => {
  for (const level of ["bhag", "monthly", "weekly", "daily", "task"]) {
    const r = validateProposalInput({
      level,
      content: `goal at ${level}`,
      sourceMessageId: "msg_123",
    });
    assert.equal(r.ok, true, `expected level "${level}" to be accepted`);
  }
});
