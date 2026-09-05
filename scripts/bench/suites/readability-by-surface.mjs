#!/usr/bin/env node
/**
 * Benchmark suite: reading grade by surface.
 *
 * config/benchmarks/readability-by-surface.json — gate, no `requires` (pure
 * source-file scan, no DB/server/browser).
 *
 * Reuses `scanReadabilityForRoots()` from scripts/ui-copy-readability.mjs —
 * the same Flesch-Kincaid scorer (src/lib/sage/readability.ts) that already
 * gates `npm run ui-copy:readability -- --gate` — grouped by the route
 * families in the fixture instead of one pooled report, per
 * docs/superpowers/plans/2026-09-05-benchmark-suite.md's A8 scope.
 *
 * Contract (docs/superpowers/plans/2026-09-05-benchmark-suite.md):
 *   run(ctx) -> { metrics: [{ id, value, n, details }] }
 *   ctx = { fixture, fixturePath, env, log, now }
 *
 * `--self-test` runs against the real fixture and prints the metrics.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root: this file lives at scripts/bench/suites/<name>.mjs, three
// levels under the repo root.
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const FIXTURE_PATH = join(REPO_ROOT, "config/benchmarks/fixtures/readability-by-surface.json");
const SCANNER_PATH = join(REPO_ROOT, "scripts/ui-copy-readability.mjs");
const WORST_PER_METRIC = 15;
const WORST_PER_FAMILY = 5;
const TRUNCATE_AT = 110;

function truncate(text) {
  return text.length > TRUNCATE_AT ? `${text.slice(0, TRUNCATE_AT)}…` : text;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function toWorstEntry(candidate) {
  return {
    file: candidate.file,
    line: candidate.line,
    grade: candidate.grade,
    text: truncate(candidate.text),
  };
}

export async function run(ctx) {
  const fixture = ctx?.fixture ?? JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const { scanReadabilityForRoots } = await import(SCANNER_PATH);

  const byFamily = {};
  const studentGrades = [];
  const employerGrades = [];
  const studentWorst = [];
  const employerWorst = [];

  for (const family of fixture.families) {
    const candidates = await scanReadabilityForRoots(family.paths);
    const scorable = candidates.filter((c) => c.scorable && !c.exempt);
    const grades = scorable.map((c) => c.grade);
    const familyWorst = scorable
      .slice()
      .sort((a, b) => b.grade - a.grade)
      .slice(0, WORST_PER_FAMILY)
      .map(toWorstEntry);

    byFamily[family.id] = {
      label: family.label,
      audience: family.audience,
      files: new Set(candidates.map((c) => c.file)).size,
      n: scorable.length,
      median: median(grades),
      max: grades.length > 0 ? Math.max(...grades) : null,
      worst: familyWorst,
    };

    const bucket = family.audience === "employer" ? employerGrades : studentGrades;
    bucket.push(...grades);
    const worstBucket = family.audience === "employer" ? employerWorst : studentWorst;
    worstBucket.push(...scorable.map(toWorstEntry));
  }

  studentWorst.sort((a, b) => b.grade - a.grade);
  employerWorst.sort((a, b) => b.grade - a.grade);

  const medianStudent = median(studentGrades);
  const maxStudent = studentGrades.length > 0 ? Math.max(...studentGrades) : null;
  const medianEmployer = median(employerGrades);

  return {
    metrics: [
      {
        id: "median_grade_student",
        value: medianStudent ?? 0,
        n: studentGrades.length,
        details: { byFamily, worst: studentWorst.slice(0, WORST_PER_METRIC) },
      },
      {
        id: "max_grade_student",
        value: maxStudent ?? 0,
        n: studentGrades.length,
        details: { worst: studentWorst.slice(0, WORST_PER_METRIC) },
      },
      {
        id: "median_grade_employer",
        value: medianEmployer ?? 0,
        n: employerGrades.length,
        details: { worst: employerWorst.slice(0, WORST_PER_METRIC) },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// --self-test: run against the real fixture, print the metrics, exit 1 on a
// thrown error. No runner exists yet (this suite ships ahead of Phase 0's
// A0 runner per the build plan), so this bootstrap is self-contained rather
// than shared — see the sibling suites in this directory for the same
// pattern.
// ---------------------------------------------------------------------------
const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
  } catch {
    return false;
  }
})();

if (isMainModule && process.argv.includes("--self-test")) {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const started = Date.now();
  run({ fixture, fixturePath: FIXTURE_PATH, env: {}, log: console, now: () => new Date() })
    .then((result) => {
      console.log("readability-by-surface --self-test");
      console.log(`  duration: ${Date.now() - started}ms\n`);
      for (const metric of result.metrics) {
        console.log(`  ${metric.id}: ${metric.value} (n=${metric.n})`);
      }
      console.log("\nPer-family breakdown:");
      const byFamily = result.metrics[0].details.byFamily;
      for (const [id, fam] of Object.entries(byFamily)) {
        console.log(
          `  [${fam.audience}] ${id} (${fam.label}) — files=${fam.files} n=${fam.n} median=${fam.median ?? "n/a"} max=${fam.max ?? "n/a"}`,
        );
      }
      console.log("\n--self-test: PASS");
    })
    .catch((err) => {
      console.error("--self-test: FAIL");
      console.error(err);
      process.exitCode = 1;
    });
}
