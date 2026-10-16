import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreDiff, scriptFromDiffFailure } from "./migration-drift-schema.mjs";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

// The shapes `prisma migrate diff --script` prints: a `-- Kind` comment above
// each statement, statements that can span lines, and a comment alone when
// there is nothing to change.
const EMPTY = "-- This is an empty migration.\n";
const DROP_HNSW = 'DROP INDEX "visionquest"."DocumentChunk_embedding_hnsw_idx";';
const TWO_STATEMENTS = `-- DropIndex
${DROP_HNSW}

-- AlterTable
ALTER TABLE "visionquest"."Application" ADD COLUMN     "pathwayClusterId" TEXT,
ADD COLUMN     "pathwaySnapshotAt" TIMESTAMP(3);
`;

const exempting = (...entries) => ({ exemptions: entries });

test("an empty migration is no drift, even though Prisma prints a comment for it", () => {
  const metric = scoreDiff(EMPTY, exempting());
  assert.equal(metric.value, 0);
  assert.equal(metric.n, 1);
});

test("each statement the diff would run counts once, multi-line ones included", () => {
  const metric = scoreDiff(TWO_STATEMENTS, exempting());
  assert.equal(metric.value, 2);
  assert.deepEqual(metric.details.unexplained, [
    DROP_HNSW,
    'ALTER TABLE "visionquest"."Application" ADD COLUMN "pathwayClusterId" TEXT, ADD COLUMN "pathwaySnapshotAt" TIMESTAMP(3);',
  ]);
});

test("an exempted statement is listed as exempted and not counted", () => {
  const metric = scoreDiff(
    `-- DropIndex\n${DROP_HNSW}\n`,
    exempting({ statement: DROP_HNSW, reason: "HNSW cannot be declared in schema.prisma" })
  );
  assert.equal(metric.value, 0);
  assert.deepEqual(metric.details.exempted, [DROP_HNSW]);
});

test("an exemption the diff no longer produces is reported as stale", () => {
  const metric = scoreDiff(EMPTY, exempting({ statement: DROP_HNSW, reason: "HNSW cannot be declared" }));
  assert.equal(metric.value, 0);
  assert.deepEqual(metric.details.staleExemptions, [DROP_HNSW]);
});

test("an exemption without a reason is refused", () => {
  assert.throws(() => scoreDiff(TWO_STATEMENTS, exempting({ statement: DROP_HNSW, reason: "" })), /reason/);
});

test("a diff that exits 2 with a script is drift to score", () => {
  assert.equal(scriptFromDiffFailure({ code: 2, stdout: TWO_STATEMENTS, stderr: "" }), TWO_STATEMENTS);
});

test("a diff that could not run is an error, not one statement of drift", () => {
  // A failed replay used to read as `value: 1`, which says the schema drifted
  // when nothing was compared at all.
  assert.throws(
    () =>
      scriptFromDiffFailure({
        code: 1,
        stdout: "",
        stderr: "Error: P3006 Migration `20260610120100_add_document_embeddings` failed to apply cleanly",
        message: "Command failed: npx prisma migrate diff",
      }),
    /nothing was measured[\s\S]*P3006/
  );
});

test("the suite reads its own exemption list, not migration-drift's RLS one", () => {
  const config = JSON.parse(
    readFileSync(join(REPO_ROOT, "config", "benchmarks", "migration-drift-schema.json"), "utf8")
  );
  assert.equal(config.fixture, "config/benchmarks/fixtures/migration-drift-schema.json");
  const fixture = JSON.parse(readFileSync(join(REPO_ROOT, config.fixture), "utf8"));
  assert.ok(Array.isArray(fixture.exemptions));
  for (const entry of fixture.exemptions) {
    assert.ok(entry.statement && entry.reason, JSON.stringify(entry));
  }
});
