import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planMemoryPseudonymization, tallyPlan, buildVault } from "./memory-pseudonymize-backfill.mjs";
// Dynamic + destructured for the same reason memory-pseudonymize-backfill.mjs
// uses it (see the comment there): a static named import from a `.ts` file
// throws under this project's CJS-rooted package.json.
const { sourceHashFor } = await import("../../src/lib/sage/memory/schema.ts");

const IDENTITY = {
  studentName: "Jordan Lee",
  studentEmail: "jordan.lee@example.org",
};

function row(overrides) {
  const subjectType = "student";
  const subjectId = "stu-1";
  const content = overrides.content;
  return {
    id: overrides.id,
    subjectType,
    subjectId,
    content,
    sourceHash: overrides.sourceHash ?? sourceHashFor({ subjectType, subjectId, content }),
    createdAt: overrides.createdAt,
  };
}

describe("planMemoryPseudonymization", () => {
  it("returns [] for an empty row set", () => {
    assert.deepEqual(planMemoryPseudonymization([], IDENTITY), []);
  });

  it("rewrites a raw-name row with no colliding twin", () => {
    const raw = row({
      id: "mem-1",
      content: "Jordan Lee wants to finish the CDL course by June.",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const actions = planMemoryPseudonymization([raw], IDENTITY);

    assert.equal(actions.length, 1);
    const [action] = actions;
    assert.equal(action.type, "rewrite");
    assert.equal(action.id, "mem-1");
    assert.equal(action.content, "[STUDENT_NAME] wants to finish the CDL course by June.");
    assert.equal(
      action.sourceHash,
      sourceHashFor({ subjectType: "student", subjectId: "stu-1", content: action.content }),
    );
  });

  it("leaves a third-party name untouched — the documented residual limit ('her son Jayden')", () => {
    // The vault only knows the acting student's own identity fields, never
    // names typed in passing about someone else — see identity.ts and the
    // ai-deidentification runbook's "third-party names cannot be caught".
    const thirdParty = row({
      id: "mem-2",
      content: "Her son Jayden is doing well in kindergarten this year.",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    const actions = planMemoryPseudonymization([thirdParty], IDENTITY);

    assert.deepEqual(actions, [{ type: "unchanged", id: "mem-2" }]);
  });

  it("the email family wins over a name-inside-email match (the ordering bug Wave 2 fixed)", () => {
    // "jordan.lee@example.org" contains the pattern "Jordan[.\\s-]Lee" — a
    // names-first substitution would produce "[STUDENT_NAME]@example.org",
    // breaking the email apart. Contact values must be substituted first.
    const emailRow = row({
      id: "mem-3",
      content: "Email me at jordan.lee@example.org anytime this week.",
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    });

    const actions = planMemoryPseudonymization([emailRow], IDENTITY);

    assert.equal(actions.length, 1);
    const [action] = actions;
    assert.equal(action.type, "rewrite");
    assert.ok(
      action.content.includes("[STUDENT_EMAIL]"),
      `expected the whole email to become one token, got: ${action.content}`,
    );
    assert.ok(
      !action.content.includes("[STUDENT_NAME]@"),
      `email must not have been split by a names-first pass, got: ${action.content}`,
    );
  });

  it("dedupes a raw row against its already-pseudonymized twin, keeping the newer row", () => {
    const olderRaw = row({
      id: "mem-old-raw",
      content: "Jordan Lee wants to finish the CDL course by June.",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    // The twin a LATER turn extracted, already pseudonymized (write-time
    // pass already shipped when this row was written) — same underlying
    // fact, same final content, so its stored sourceHash already equals
    // what pseudonymizing the raw row above produces.
    const newerPseudonymized = row({
      id: "mem-new-pseudo",
      content: "[STUDENT_NAME] wants to finish the CDL course by June.",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    });

    const actions = planMemoryPseudonymization([olderRaw, newerPseudonymized], IDENTITY);

    assert.equal(actions.length, 2);
    const byId = new Map(actions.map((a) => [a.id, a]));
    assert.deepEqual(byId.get("mem-old-raw"), { type: "dedupe", id: "mem-old-raw", keptId: "mem-new-pseudo" });
    assert.deepEqual(byId.get("mem-new-pseudo"), { type: "unchanged", id: "mem-new-pseudo" });
  });

  it("dedupes a raw row against a NEWER raw row with the same underlying content, keeping the newer one and rewriting it", () => {
    const olderRaw = row({
      id: "mem-a",
      content: "Jordan Lee wants to finish the CDL course by June.",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newerRaw = row({
      id: "mem-b",
      content: "Jordan Lee wants to finish the CDL course by June.",
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    });

    const actions = planMemoryPseudonymization([olderRaw, newerRaw], IDENTITY);

    assert.equal(actions.length, 2);
    const byId = new Map(actions.map((a) => [a.id, a]));
    assert.deepEqual(byId.get("mem-a"), { type: "dedupe", id: "mem-a", keptId: "mem-b" });
    const kept = byId.get("mem-b");
    assert.equal(kept.type, "rewrite");
    assert.equal(kept.content, "[STUDENT_NAME] wants to finish the CDL course by June.");
  });

  it("leaves an already-pseudonymized, non-colliding row unchanged (idempotent under a second pass)", () => {
    const already = row({
      id: "mem-4",
      content: "[STUDENT_NAME] wants to finish the CDL course by June.",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const actions = planMemoryPseudonymization([already], IDENTITY);

    assert.deepEqual(actions, [{ type: "unchanged", id: "mem-4" }]);
  });
});

describe("buildVault", () => {
  it("builds a vault that substitutes the student's own name", () => {
    const vault = buildVault(IDENTITY);
    assert.equal(vault.pseudonymize("Jordan Lee said hi."), "[STUDENT_NAME] said hi.");
  });

  it("never tokenizes an allowlisted value (988)", () => {
    const vault = buildVault(IDENTITY);
    assert.equal(vault.pseudonymize("Call 988 if you need help."), "Call 988 if you need help.");
  });
});

describe("tallyPlan", () => {
  it("counts rewritten, deduped, and unchanged separately, never a name", () => {
    const actions = [
      { type: "rewrite", id: "1", content: "x", sourceHash: "h" },
      { type: "rewrite", id: "2", content: "y", sourceHash: "h2" },
      { type: "dedupe", id: "3", keptId: "2" },
      { type: "unchanged", id: "4" },
      { type: "unchanged", id: "5" },
      { type: "unchanged", id: "6" },
    ];

    assert.deepEqual(tallyPlan(actions), { rewritten: 2, deduped: 1, unchanged: 3 });
  });

  it("returns all zeros for an empty plan", () => {
    assert.deepEqual(tallyPlan([]), { rewritten: 0, deduped: 0, unchanged: 0 });
  });
});
