#!/usr/bin/env node
// Benchmark suite: migration-drift (gate, no requires).
//
// Parses every migration in prisma/migrations for `CREATE TABLE
// "visionquest"."<T>"` and `ALTER TABLE "visionquest"."<T>" ENABLE ROW LEVEL
// SECURITY`, and reports tables that were created but never had RLS enabled
// anywhere in the migration history — the F8 finding from
// docs/audits/2026-09-01-full-review.md, made falsifiable and CI-gated.
//
// A table is only counted if it still has a live model in prisma/schema.prisma
// (a table created and later dropped in migration history, or one that exists
// only as prod drift outside this repo's migrations, is out of scope for a
// gate that can only see committed migrations).
//
// See config/benchmarks/fixtures/rls-exemptions.json for the contract on
// exempting a table (non-personal data only, verified per-table, never by name).

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "prisma/migrations");
const SCHEMA_PATH = path.join(REPO_ROOT, "prisma/schema.prisma");
const EXEMPTIONS_PATH = path.join(
  REPO_ROOT,
  "config/benchmarks/fixtures/rls-exemptions.json",
);

const CREATE_TABLE_RE = /CREATE TABLE "visionquest"\."([A-Za-z0-9_]+)"/g;
const ENABLE_RLS_RE =
  /ALTER TABLE "visionquest"\."([A-Za-z0-9_]+)"\s+ENABLE ROW LEVEL SECURITY/g;
const DROP_TABLE_RE = /DROP TABLE (?:IF EXISTS )?"visionquest"\."([A-Za-z0-9_]+)"/g;
const MODEL_RE = /^model\s+([A-Za-z0-9_]+)\s*\{/gm;

function listMigrationSqlFiles() {
  const entries = readdirSync(MIGRATIONS_DIR).filter((name) => {
    const full = path.join(MIGRATIONS_DIR, name);
    return statSync(full).isDirectory();
  });
  // Migration folders are timestamp-prefixed, so lexical order is chronological.
  entries.sort();
  return entries
    .map((dir) => path.join(MIGRATIONS_DIR, dir, "migration.sql"))
    .filter((file) => {
      try {
        statSync(file);
        return true;
      } catch {
        return false;
      }
    });
}

function matchAll(re, text) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/** Every table CREATEd, minus any later DROPped, across migration history. */
function computeCreatedTables() {
  const created = new Set();
  for (const file of listMigrationSqlFiles()) {
    const text = readFileSync(file, "utf8");
    for (const t of matchAll(CREATE_TABLE_RE, text)) created.add(t);
    for (const t of matchAll(DROP_TABLE_RE, text)) created.delete(t);
  }
  return created;
}

/** Every table that got ENABLE ROW LEVEL SECURITY at any point (conditional
 *  EXECUTE blocks count too — a legacy table guarded by an `IF EXISTS` still
 *  proves the intent to RLS it, which is all this signal needs). */
function computeRlsTables() {
  const rls = new Set();
  for (const file of listMigrationSqlFiles()) {
    const text = readFileSync(file, "utf8");
    for (const t of matchAll(ENABLE_RLS_RE, text)) rls.add(t);
  }
  return rls;
}

function computeLiveModels() {
  const text = readFileSync(SCHEMA_PATH, "utf8");
  return new Set(matchAll(MODEL_RE, text));
}

function loadExemptions() {
  try {
    const raw = JSON.parse(readFileSync(EXEMPTIONS_PATH, "utf8"));
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith("_")) continue;
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export async function run(_ctx) {
  const created = computeCreatedTables();
  const rls = computeRlsTables();
  const liveModels = computeLiveModels();
  const exemptions = loadExemptions();

  const candidateGaps = [...created]
    .filter((t) => liveModels.has(t))
    .filter((t) => !rls.has(t))
    .sort();

  const exempted = candidateGaps.filter((t) => Object.hasOwn(exemptions, t));
  const reported = candidateGaps.filter((t) => !Object.hasOwn(exemptions, t));

  return {
    metrics: [
      {
        id: "tables_without_rls",
        value: reported.length,
        n: created.size,
        details: {
          tablesCreated: created.size,
          tablesWithRls: rls.size,
          exempted: exempted.map((t) => ({ table: t, reason: exemptions[t] })),
          reported,
        },
      },
    ],
  };
}

if (process.argv.includes("--self-test")) {
  run({ fixture: null, fixturePath: EXEMPTIONS_PATH, env: {}, log: console.log, now: () => new Date() })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      const metric = result.metrics.find((m) => m.id === "tables_without_rls");
      if (!metric || metric.value !== 0) {
        console.error(
          `FAIL: tables_without_rls = ${metric?.value} (expected 0 after exemptions). ` +
            `Unexempted tables: ${JSON.stringify(metric?.details?.reported)}`,
        );
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
