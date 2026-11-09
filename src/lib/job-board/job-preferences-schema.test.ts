/**
 * W4 schema guard: a student's saved job must outlive its listing row, and the
 * migration that makes it so must stay additive. Read from the generated
 * Prisma DMMF and from the migration SQL text; no database is needed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";

const MIGRATION = join(
  process.cwd(),
  "prisma/migrations/20261109120000_durable_job_preferences/migration.sql",
);

function field(model: string, name: string) {
  const found = Prisma.dmmf.datamodel.models
    .find((m) => m.name === model)
    ?.fields.find((f) => f.name === name);
  assert.ok(found, `${model}.${name} exists in the DMMF`);
  return found;
}

function migrationSql(): string {
  return readFileSync(MIGRATION, "utf8");
}

describe("durable job preferences schema", () => {
  it("clears a saved job's class listing link instead of deleting the save", () => {
    const relation = field("StudentSavedJob", "jobListing");
    assert.equal(relation.isRequired, false);
    assert.equal(relation.relationOnDelete, "SetNull");
  });

  it("links a saved job to a browse listing the same way", () => {
    const relation = field("StudentSavedJob", "jobBrowseListing");
    assert.equal(relation.isRequired, false);
    assert.equal(relation.relationOnDelete, "SetNull");
  });

  it("keeps one hidden row per student per vacancy, with no listing foreign key", () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "StudentHiddenJob");
    assert.ok(model);
    assert.deepEqual(model.uniqueFields, [["studentId", "vacancyKey"]]);
    const relations = model.fields.filter((f) => f.kind === "object").map((f) => f.type);
    assert.deepEqual(relations, ["Student"]);
  });

  it("rewrites both listing foreign keys to ON DELETE SET NULL in the migration", () => {
    const sql = migrationSql();
    assert.match(sql, /"StudentSavedJob_jobListingId_fkey"[^;]*ON DELETE SET NULL/);
    assert.match(sql, /"StudentSavedJob_jobBrowseListingId_fkey"[^;]*ON DELETE SET NULL/);
  });

  it("drops no table, column or data", () => {
    const sql = migrationSql().replace(/--.*$/gm, "");
    assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)/i);
    assert.doesNotMatch(sql, /\b(DELETE\s+FROM|TRUNCATE)\b/i);
  });

  it("puts StudentHiddenJob under RLS with a student-scoped policy", () => {
    const sql = migrationSql();
    assert.match(sql, /ALTER TABLE "visionquest"\."StudentHiddenJob" ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /CREATE POLICY "student_hidden_job_access"[\s\S]*"studentId" = current_setting\('app\.current_user_id', true\)/);
    assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"\."StudentHiddenJob" TO vq_app/);
  });
});
