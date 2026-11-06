// Run: node --test scripts/rls-teacher-branches.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findUnscopedBranches,
  missingTreeReaderWriteBlocks,
  ownerColumnFor,
  parsePolicyStatement,
  replayMigrations,
  requiresManaged,
  splitStatements,
  stripComments,
  teacherArms,
  teacherWriteTables,
  writeBlockSql,
} from "./rls-teacher-branches.mjs";

const ROLE = "current_setting('app.current_role', true)";
const MANAGED = "visionquest.managed_student_ids(current_setting('app.current_user_id', true))";

describe("splitStatements and stripComments", () => {
  it("keeps semicolons inside dollar quotes and strings, drops comments", () => {
    const sql = [
      "-- a comment; with a semicolon",
      "CREATE FUNCTION f() AS $fn$ SELECT 1; SELECT 2; $fn$;",
      "/* block; */ SELECT 'a;b';",
    ].join("\n");
    assert.deepEqual(splitStatements(stripComments(sql)), [
      "CREATE FUNCTION f() AS $fn$ SELECT 1; SELECT 2; $fn$",
      "SELECT 'a;b'",
    ]);
  });
});

describe("parsePolicyStatement", () => {
  it("reads name, table, mode, command and both clauses", () => {
    const policy = parsePolicyStatement(
      `CREATE POLICY "p" ON "visionquest"."T" AS RESTRICTIVE FOR DELETE TO vq_app USING (a = (b)) WITH CHECK (c)`,
    );
    assert.deepEqual(policy, {
      kind: "create", name: "p", table: "T", command: "DELETE", mode: "restrictive",
      using: "a = (b)", withCheck: "c",
    });
  });

  it("defaults to FOR ALL and permissive, and reads DROP POLICY", () => {
    const policy = parsePolicyStatement(`CREATE POLICY p ON visionquest."T" TO vq_app USING (true)`);
    assert.equal(policy.command, "ALL");
    assert.equal(policy.mode, "permissive");
    assert.equal(policy.withCheck, null);
    assert.deepEqual(parsePolicyStatement(`DROP POLICY IF EXISTS "p" ON "visionquest"."T"`), {
      kind: "drop", name: "p", table: "T",
    });
  });
});

describe("requiresManaged", () => {
  it("needs managed_student_ids on every OR path", () => {
    assert.equal(requiresManaged(`${ROLE} = 'teacher' AND "studentId" IN (SELECT ${MANAGED})`), true);
    assert.equal(requiresManaged(`${ROLE} = 'teacher' AND ("x" != 'student' OR "id" IN (SELECT ${MANAGED}))`), false);
    assert.equal(requiresManaged(`CASE WHEN a THEN "id" IN (SELECT ${MANAGED}) ELSE true END`), false);
    assert.equal(requiresManaged(`${ROLE} IN ('admin', 'teacher')`), false);
  });
});

describe("teacherArms", () => {
  it("ignores scoped arms and classifies the rest", () => {
    const scoped = `${ROLE} = 'admin' OR ( ${ROLE} = 'teacher' AND "studentId" IN (SELECT ${MANAGED}) )`;
    assert.deepEqual(teacherArms(scoped), []);
    const open = `${ROLE} IN ('admin', 'teacher') OR ("studentId" = 'x')`;
    assert.deepEqual(teacherArms(open), [{ arm: `${ROLE} IN ('admin', 'teacher')`, scope: "none" }]);
    const partial = `( ${ROLE} = 'teacher' AND (a OR "id" IN (SELECT ${MANAGED})) )`;
    assert.equal(teacherArms(partial)[0].scope, "partial");
  });

  it("finds a teacher check nested inside an EXISTS subquery", () => {
    const nested = `EXISTS (SELECT 1 FROM w WHERE w.id = x AND ( ${ROLE} IN ('admin', 'teacher') OR (w.s = 'y') ))`;
    assert.equal(teacherArms(nested)[0].scope, "none");
  });
});

describe("replayMigrations and findUnscopedBranches", () => {
  const open = (name) =>
    `CREATE POLICY "${name}" ON "visionquest"."T" FOR SELECT TO vq_app USING (${ROLE} IN ('admin', 'teacher'));`;

  it("keeps the latest definition in folder order and honors DROP POLICY", () => {
    const live = replayMigrations([
      { folder: "20260102_b", sql: `DROP POLICY IF EXISTS "gone" ON "visionquest"."T";\n${open("kept")}` },
      { folder: "20260101_a", sql: `${open("gone")}\nCREATE POLICY "kept" ON "visionquest"."T" USING (true);` },
    ]);
    assert.deepEqual([...live.keys()], ["T::kept"]);
    assert.equal(live.get("T::kept").folder, "20260102_b");
  });

  it("reports read for SELECT, read/write for ALL USING, write for WITH CHECK", () => {
    const live = replayMigrations([
      {
        folder: "a",
        sql: `${open("r")}\nCREATE POLICY "rw" ON "visionquest"."T" FOR ALL TO vq_app USING (${ROLE} = 'teacher') WITH CHECK (${ROLE} = 'teacher');`,
      },
    ]);
    const rows = findUnscopedBranches(live).map((r) => `${r.policy}:${r.clause}:${r.access}`);
    assert.deepEqual(rows, ["r:USING:read", "rw:USING:read/write", "rw:WITH CHECK:write"]);
  });
});

describe("tree-reader write blocks", () => {
  const teacherWrite = `CREATE POLICY "w" ON "visionquest"."T" FOR ALL TO vq_app USING (${ROLE} = 'teacher') WITH CHECK (${ROLE} = 'teacher');`;
  const selectOnly = `CREATE POLICY "r" ON "visionquest"."R" FOR SELECT TO vq_app USING (${ROLE} = 'teacher');`;

  it("lists tables with a permissive teacher write arm, scoped or not, and skips SELECT-only ones", () => {
    const scoped = `CREATE POLICY "s" ON "visionquest"."S" FOR UPDATE TO vq_app USING (${ROLE} = 'teacher' AND "studentId" IN (SELECT ${MANAGED}));`;
    const live = replayMigrations([{ folder: "a", sql: `${teacherWrite}\n${selectOnly}\n${scoped}` }]);
    assert.deepEqual(teacherWriteTables(live), ["S", "T"]);
  });

  it("reports each write command until a restrictive is_tree_reader block covers it", () => {
    const insertBlock = `CREATE POLICY "b" ON "visionquest"."T" AS RESTRICTIVE FOR INSERT TO vq_app WITH CHECK (NOT visionquest.is_tree_reader('x'));`;
    const live = replayMigrations([{ folder: "a", sql: `${teacherWrite}\n${insertBlock}` }]);
    assert.deepEqual(missingTreeReaderWriteBlocks(live), ["T:UPDATE", "T:DELETE"]);
    const allBlock = `CREATE POLICY "c" ON "visionquest"."T" AS RESTRICTIVE FOR ALL TO vq_app USING (NOT visionquest.is_tree_reader('x'));`;
    assert.deepEqual(missingTreeReaderWriteBlocks(replayMigrations([{ folder: "a", sql: `${teacherWrite}\n${allBlock}` }])), []);
  });

  it("does not count a permissive policy that mentions is_tree_reader as a block", () => {
    const permissive = `CREATE POLICY "p" ON "visionquest"."T" FOR ALL TO vq_app USING (visionquest.is_tree_reader('x'));`;
    const live = replayMigrations([{ folder: "a", sql: `${teacherWrite}\n${permissive}` }]);
    assert.deepEqual(missingTreeReaderWriteBlocks(live), ["T:INSERT", "T:UPDATE", "T:DELETE"]);
  });

  it("emitted SQL parses back into blocks that close the gap, with the owner carve-out", () => {
    const sql = writeBlockSql("StudentTask", "studentId");
    assert.match(sql, /"student_task_tree_reader_no_insert"/);
    assert.match(sql, /OR "studentId" = current_setting\('app\.current_user_id', true\)/);
    const live = replayMigrations([{ folder: "a", sql: teacherWrite.replaceAll('"T"', '"StudentTask"') }, { folder: "b", sql }]);
    assert.deepEqual(missingTreeReaderWriteBlocks(live), []);
    assert.doesNotMatch(writeBlockSql("Employer", null), / OR "/);
  });

  it("picks the owner column from the schema", () => {
    const schema = "model Goal {\n  id String\n  studentId String\n}\nmodel Employer {\n  id String\n}\n";
    assert.equal(ownerColumnFor("Goal", schema), "studentId");
    assert.equal(ownerColumnFor("Employer", schema), null);
    assert.equal(ownerColumnFor("Student", schema), "id");
    assert.equal(ownerColumnFor("SageOperation", schema), "actorId");
  });
});
