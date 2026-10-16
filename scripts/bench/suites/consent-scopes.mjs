#!/usr/bin/env node
// Benchmark suite: consent-scopes (requires: postgres; skips cleanly otherwise).
//
// The actual assertions live in a node:test file —
// src/lib/connect/consent-scopes.bench.test.ts — because the guarded write
// paths it exercises (`sendConnection`, `selectBatchStudents`) call through
// the app's own `prisma` singleton, which only becomes RLS-aware inside
// `withRlsContext` + `RLS_CONTEXT_INJECTION=true`; that is a real production
// code path, not something a hermetic-DB bootstrap outside node:test can
// stand in for. This scorer runs that file as a child process (`npx tsx
// --test --test-reporter=tap`) and parses its TAP output into the metric
// shape the contract wants, per the plan's own documented fallback for
// exactly this case.
//
// A "pass" in the underlying test means the guarded function refused to send
// or include an unconsented student's data — i.e. writes_without_scope 0 for
// that assertion. A test FAILURE (not a skip) means a write got through
// without the matching consent scope, which is what this metric counts.
//
// Counts come from the closing TAP summary (`# pass 3`), which counts tests.
// The reporter is named because Node 24 prints its spec report by default,
// even through a pipe, and spec output has no TAP lines at all. A run with no
// summary, a cancelled test (fixture setup failed) or the test file skipping
// itself despite the opt-in measured nothing, so each one throws and the
// runner records an error rather than 0 writes.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");
const TEST_FILE = "src/lib/connect/consent-scopes.bench.test.ts";
const RUN_TIMEOUT_MS = 60_000;
export const CHILD_ARGS = ["tsx", "--test", "--test-reporter=tap", TEST_FILE];

const SUMMARY_LINE = /^# (tests|pass|fail|cancelled) (\d+)\s*$/;
const SKIPPED_ITSELF = /# Subtest: consent scopes \(integration\) — SKIPPED/;
const NOT_OK = /^\s*not ok \d+ - (.*)$/;

function parseTap(tapText) {
  const counts = {};
  const failures = [];
  let skippedItself = false;
  for (const line of tapText.split("\n")) {
    if (SKIPPED_ITSELF.test(line)) skippedItself = true;
    // The last count wins: node:test echoes a test process's stray stdout as
    // `# ...` comments, and the closing summary always comes after them.
    const count = line.match(SUMMARY_LINE);
    if (count) counts[count[1]] = Number(count[2]);
    const notOk = line.match(NOT_OK);
    if (notOk) failures.push(notOk[1]);
  }
  const hasSummary = ["tests", "pass", "fail"].every((key) => key in counts);
  return { hasSummary, counts, skippedItself, failures };
}

export async function run(ctx) {
  const databaseUrl = ctx?.env?.databaseUrl ?? process.env.DATABASE_URL;
  const rlsTestEnabled = process.env.RLS_TEST_ENABLED === "true";

  if (!databaseUrl || !rlsTestEnabled) {
    return {
      metrics: [
        {
          id: "writes_without_scope",
          value: 0,
          n: 0,
          details: {
            skipped: true,
            reason: !databaseUrl
              ? "no DATABASE_URL"
              : "RLS_TEST_ENABLED is not \"true\" — this suite writes real fixture rows and is opt-in, same convention as src/lib/rls.test.ts",
          },
        },
      ],
    };
  }

  const tapText = await new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn("npx", CHILD_ARGS, {
      cwd: REPO_ROOT,
      env: process.env,
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => chunks.push(d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });

  return { metrics: [scoreTap(tapText)] };
}

export function scoreTap(tapText) {
  const parsed = parseTap(tapText);
  const tail = tapText.slice(-4000);
  if (!parsed.hasSummary) {
    throw new Error(`${TEST_FILE} produced no TAP summary, so nothing was measured. Output tail:\n${tail}`);
  }
  if (parsed.skippedItself) {
    throw new Error(
      `${TEST_FILE} skipped itself although the scorer saw RLS_TEST_ENABLED=true and a DATABASE_URL, so nothing was measured`
    );
  }
  const cancelled = parsed.counts.cancelled ?? 0;
  if (cancelled > 0) {
    throw new Error(
      `${cancelled} test(s) in ${TEST_FILE} were cancelled, usually because fixture setup failed, ` +
        `so those write paths were never exercised. Output tail:\n${tail}`
    );
  }
  const { pass, fail } = parsed.counts;
  return {
    id: "writes_without_scope",
    value: fail,
    n: pass + fail,
    details: {
      assertionsPassed: pass,
      assertionsFailed: fail,
      failures: parsed.failures.slice(0, 20),
      rawTapTail: fail > 0 ? tail : undefined,
    },
  };
}

if (process.argv.includes("--self-test")) {
  // Self-test never has RLS_TEST_ENABLED, so it proves the skip path works
  // without touching a database. scoreTap's own cases are in
  // consent-scopes.test.mjs.
  run({ fixture: null, fixturePath: TEST_FILE, env: {}, log: console.log, now: () => new Date() })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      const metric = result.metrics[0];
      if (!metric.details.skipped) {
        console.error("FAIL: expected a clean skip with no DATABASE_URL/RLS_TEST_ENABLED set");
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
