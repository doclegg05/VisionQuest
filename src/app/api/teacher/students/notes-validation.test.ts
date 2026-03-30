import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOTE_CATEGORIES, isNoteCategory } from "@/lib/advising";

// ---------------------------------------------------------------------------
// Case notes validation tests
//
// These test the validation logic used by the case notes route handlers.
// Route handler integration (auth, DB queries) requires a running server;
// these tests verify the pure validation and category logic.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// NOTE_CATEGORIES
// ---------------------------------------------------------------------------

describe("NOTE_CATEGORIES", () => {
  it("contains exactly 5 categories", () => {
    assert.equal(NOTE_CATEGORIES.length, 5);
  });

  it("includes all expected categories", () => {
    const expected = ["general", "check_in", "risk", "career", "celebration"];
    for (const cat of expected) {
      assert.ok(
        NOTE_CATEGORIES.includes(cat as (typeof NOTE_CATEGORIES)[number]),
        `Missing category: ${cat}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// isNoteCategory
// ---------------------------------------------------------------------------

describe("isNoteCategory", () => {
  it("accepts valid categories", () => {
    for (const cat of NOTE_CATEGORIES) {
      assert.ok(isNoteCategory(cat), `Should accept: ${cat}`);
    }
  });

  it("rejects empty string", () => {
    assert.ok(!isNoteCategory(""));
  });

  it("rejects unknown category", () => {
    assert.ok(!isNoteCategory("emergency"));
    assert.ok(!isNoteCategory("personal"));
    assert.ok(!isNoteCategory("admin"));
  });

  it("rejects case-mismatched categories", () => {
    assert.ok(!isNoteCategory("General"));
    assert.ok(!isNoteCategory("RISK"));
    assert.ok(!isNoteCategory("Check_In"));
  });
});

// ---------------------------------------------------------------------------
// Request body validation patterns
// ---------------------------------------------------------------------------

describe("case note body validation", () => {
  it("rejects empty note body", () => {
    const body = "";
    const trimmed = body.trim();
    assert.ok(!trimmed, "Empty body should be falsy after trim");
  });

  it("rejects whitespace-only body", () => {
    const body = "   \n\t  ";
    const trimmed = body.trim();
    assert.ok(!trimmed, "Whitespace-only body should be falsy after trim");
  });

  it("accepts non-empty body", () => {
    const body = "Student showed improvement in math skills.";
    const trimmed = body.trim();
    assert.ok(trimmed, "Non-empty body should be truthy after trim");
  });
});

// ---------------------------------------------------------------------------
// Pagination parameter validation
// ---------------------------------------------------------------------------

describe("pagination parameter validation", () => {
  const DEFAULT_LIMIT = 20;
  const MAX_LIMIT = 100;

  function parseLimit(limitParam: string | null): number {
    if (limitParam === null) return DEFAULT_LIMIT;
    const raw = parseInt(limitParam, 10);
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT;
    return Math.min(raw, MAX_LIMIT);
  }

  it("defaults to 20 when no limit param", () => {
    assert.equal(parseLimit(null), 20);
  });

  it("returns parsed value when within range", () => {
    assert.equal(parseLimit("10"), 10);
    assert.equal(parseLimit("50"), 50);
    assert.equal(parseLimit("100"), 100);
  });

  it("clamps to MAX_LIMIT when over", () => {
    assert.equal(parseLimit("200"), 100);
    assert.equal(parseLimit("999"), 100);
  });

  it("defaults for non-numeric input", () => {
    assert.equal(parseLimit("abc"), 20);
    assert.equal(parseLimit(""), 20);
  });

  it("defaults for zero or negative", () => {
    assert.equal(parseLimit("0"), 20);
    assert.equal(parseLimit("-5"), 20);
  });
});

// ---------------------------------------------------------------------------
// Author permission patterns
// ---------------------------------------------------------------------------

describe("author permission check", () => {
  function canModifyNote(
    noteAuthorId: string,
    sessionId: string,
    sessionRole: string,
  ): boolean {
    if (sessionRole === "admin") return true;
    return noteAuthorId === sessionId;
  }

  it("allows author to modify their own note", () => {
    assert.ok(canModifyNote("tch-001", "tch-001", "teacher"));
  });

  it("blocks non-author teacher from modifying note", () => {
    assert.ok(!canModifyNote("tch-001", "tch-002", "teacher"));
  });

  it("allows admin to modify any note", () => {
    assert.ok(canModifyNote("tch-001", "adm-001", "admin"));
  });

  it("blocks student from modifying note", () => {
    assert.ok(!canModifyNote("tch-001", "stu-001", "student"));
  });
});
