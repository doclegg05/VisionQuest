import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractPolicyBearingTables,
  extractItBlocks,
  modelsReferencedIn,
  classifyBlock,
  computeRlsCoverage,
} from "./rls-parse.mjs";

test("extractPolicyBearingTables: finds tables across multiple migration directories, deduped", () => {
  const dir = mkdtempSync(join(tmpdir(), "vq-rls-migrations-"));
  try {
    mkdirSync(join(dir, "0001_a"));
    mkdirSync(join(dir, "0002_b"));
    writeFileSync(
      join(dir, "0001_a", "migration.sql"),
      'CREATE POLICY "goal_access" ON "visionquest"."Goal" USING (true);\n',
    );
    writeFileSync(
      join(dir, "0002_b", "migration.sql"),
      'DROP POLICY IF EXISTS "goal_access" ON "visionquest"."Goal";\n' +
        'CREATE POLICY "goal_access" ON "visionquest"."Goal" USING (true);\n' +
        'CREATE POLICY "case_note_access" ON "visionquest"."CaseNote" USING (true);\n',
    );
    const tables = extractPolicyBearingTables(dir);
    assert.deepEqual(tables, ["CaseNote", "Goal"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extractPolicyBearingTables: a missing migrations directory returns an empty list", () => {
  assert.deepEqual(extractPolicyBearingTables("/does/not/exist"), []);
});

test("extractItBlocks: extracts title and body, respecting nested braces and describe grouping", () => {
  const source = `
    describe("student role", () => {
      it("sees only own Goals", async () => {
        const rows = await asRole("student", fixtures.studentB, (tx) =>
          tx.goal.findMany({ where: { id: { in: [1, 2] } } }),
        );
        assert.deepEqual(rows.map((r) => r.id), [fixtures.goalB]);
      });

      it("cannot see other students' CaseNotes at all", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.caseNote.findMany({ where: { id: 1 } }),
        );
        assert.deepEqual(rows, []);
      });
    });
  `;
  const blocks = extractItBlocks(source);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].title, "sees only own Goals");
  assert.match(blocks[0].body, /tx\.goal\.findMany/);
  assert.equal(blocks[1].title, "cannot see other students' CaseNotes at all");
  assert.match(blocks[1].body, /tx\.caseNote\.findMany/);
});

test("modelsReferencedIn: maps tx./prisma. delegate calls back to PascalCase model names", () => {
  const body = `tx.goal.findMany(); prisma.caseNote.create(); tx.sageMemory.updateMany();`;
  assert.deepEqual(modelsReferencedIn(body).sort(), ["CaseNote", "Goal", "SageMemory"]);
});

test("modelsReferencedIn: a block with no model calls returns an empty list", () => {
  assert.deepEqual(modelsReferencedIn("assert.ok(true);"), []);
});

test("classifyBlock: a non-empty length assertion is positive", () => {
  assert.deepEqual(classifyBlock("assert.equal(rows.length, 2);"), { positive: true, negative: false });
});

test("classifyBlock: a zero-length / empty-array assertion is negative", () => {
  assert.deepEqual(classifyBlock("assert.deepEqual(rows, []);"), { positive: false, negative: true });
  assert.deepEqual(classifyBlock("assert.equal(result.count, 0);"), { positive: false, negative: true });
});

test("classifyBlock: assert.rejects is negative", () => {
  assert.deepEqual(classifyBlock("await assert.rejects(() => tx.goal.create({}));"), {
    positive: false,
    negative: true,
  });
});

test("classifyBlock: a non-empty deepEqual array literal is positive", () => {
  assert.deepEqual(classifyBlock("assert.deepEqual(ids, [fixtures.goalB]);"), {
    positive: true,
    negative: false,
  });
});

test("classifyBlock: a block with neither shape is neither", () => {
  assert.deepEqual(classifyBlock("await asRole('admin', a, (tx) => tx.systemConfig.findMany({ take: 1 }));"), {
    positive: false,
    negative: false,
  });
});

test("computeRlsCoverage: a table is covered only when SOME block gives positive evidence and SOME (possibly different) block gives negative evidence", () => {
  const itBlocks = [
    { title: "sees own Goal", body: "tx.goal.findMany(); assert.equal(rows.length, 1);" },
    { title: "cannot see other Goal", body: "tx.goal.findMany(); assert.deepEqual(rows, []);" },
    { title: "sees own CaseNote", body: "tx.caseNote.findMany(); assert.equal(rows.length, 1);" },
  ];
  const result = computeRlsCoverage(["Goal", "CaseNote"], itBlocks);
  assert.deepEqual(result.coveredTables, ["Goal"]);
  assert.deepEqual(result.uncoveredTables, ["CaseNote"]);
  assert.equal(result.ratio, 0.5);
});

test("computeRlsCoverage: one block can supply BOTH positive and negative evidence for the same table", () => {
  const itBlocks = [
    {
      title: "sees only own Goal, not another's",
      body: "tx.goal.findMany(); assert.equal(mine.length, 1); assert.deepEqual(other, []);",
    },
  ];
  const result = computeRlsCoverage(["Goal"], itBlocks);
  assert.deepEqual(result.coveredTables, ["Goal"]);
});

test("computeRlsCoverage: a policy-bearing table referenced by no test at all is uncovered", () => {
  const result = computeRlsCoverage(["NeverTested"], []);
  assert.deepEqual(result.uncoveredTables, ["NeverTested"]);
  assert.equal(result.ratio, 0);
});

test("computeRlsCoverage: zero policy-bearing tables reports ratio 0, not NaN", () => {
  assert.equal(computeRlsCoverage([], []).ratio, 0);
});
