import { describe, it } from "node:test";
import assert from "node:assert";
import { shouldRewrite } from "../query-rewriter";

// ---------------------------------------------------------------------------
// shouldRewrite — false (already explicit, no rewrite needed)
// ---------------------------------------------------------------------------

describe("shouldRewrite returns false for explicit queries", () => {
  it("returns false for 'What is IC3?' (has specific identifier)", () => {
    assert.strictEqual(shouldRewrite("What is IC3?"), false);
  });

  it("returns false for 'How do I get the DFA-TS-12 form?' (has specific identifier)", () => {
    assert.strictEqual(shouldRewrite("How do I get the DFA-TS-12 form?"), false);
  });

  it("returns false for 'What are the attendance requirements for Ready to Work?' (explicit, long enough)", () => {
    assert.strictEqual(
      shouldRewrite("What are the attendance requirements for Ready to Work?"),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// shouldRewrite — true (needs conversational context)
// ---------------------------------------------------------------------------

describe("shouldRewrite returns true for ambiguous queries", () => {
  it("returns true for 'What about the MOS one?' (has 'what about')", () => {
    assert.strictEqual(shouldRewrite("What about the MOS one?"), true);
  });

  it("returns true for 'Tell me more' (short + follow-up phrase)", () => {
    assert.strictEqual(shouldRewrite("Tell me more"), true);
  });

  it("returns true for 'And part 2?' (has 'part 2')", () => {
    assert.strictEqual(shouldRewrite("And part 2?"), true);
  });
});
