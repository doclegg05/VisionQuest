// Run: node --test scripts/rls-teacher-branches.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findUnscopedBranches,
  parsePolicyStatement,
  replayMigrations,
  requiresManaged,
  splitStatements,
  stripComments,
  teacherArms,
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
