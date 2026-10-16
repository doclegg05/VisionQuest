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
// even through a pipe, and spec output has no TAP lines at all. Anything
// short of all three write paths reaching a verdict throws, and so does a
// non-zero exit with no failing test (a hook failed), so the runner records
// an error rather than 0 writes over a partial run.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");
const TEST_FILE = "src/lib/connect/consent-scopes.bench.test.ts";
const RUN_TIMEOUT_MS = 60_000;
export const CHILD_ARGS = ["tsx", "--test", "--test-reporter=tap", TEST_FILE];

// The three write paths consent-scopes.bench.test.ts exercises. A run that
// reached a verdict on fewer did not measure them all. Adding a write path
// there means raising this.
export const EXPECTED_TESTS = 3;

const SUMMARY_LINE = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/;
const NOT_OK = /^\s*not ok \d+ - (.*)$/;

function parseTap(tapText) {
  const counts = {};
  const failures = [];
  for (const line of tapText.split("\n")) {
    // The last count wins: node:test echoes a test process's stray stdout as
    // `# ...` comments, and the closing summary always comes after them.
    const count = line.match(SUMMARY_LINE);
    if (count) counts[count[1]] = Number(count[2]);
    const notOk = line.match(NOT_OK);
    if (notOk) failures.push(notOk[1]);
  }
  const hasSummary = ["tests", "pass", "fail"].every((key) => key in counts);
  return { hasSummary, counts, failures };
}

function describeCounts(counts) {
  return ["tests", "pass", "fail", "cancelled", "skipped", "todo"]
    .map((key) => `${key} ${counts[key] ?? 0}`)
    .join(", ");
}

// The test file gates on RLS_TEST_ENABLED, rls.test.ts's convention. Set in a
// workflow step, that variable would also reach every other `npm test` the
// step runs (pii-log-grep's log capture is one) and start the whole RLS suite
// there. So this scorer has its own switch and hands RLS_TEST_ENABLED to its
// child alone.
const OPT_IN = "CONSENT_SCOPES_BENCH_ENABLED";

export function childEnv(env) {
  return { ...env, RLS_TEST_ENABLED: "true" };
}

export async function run(ctx) {
  const databaseUrl = ctx?.env?.databaseUrl ?? process.env.DATABASE_URL;
  const optedIn = process.env[OPT_IN] === "true";

  if (!databaseUrl || !optedIn) {
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
              : `${OPT_IN} is not "true". This suite writes real fixture rows, so it is opt-in`,
          },
        },
      ],
    };
  }

  const { tapText, exitCode } = await new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn("npx", CHILD_ARGS, {
      cwd: REPO_ROOT,
      env: childEnv(process.env),
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => chunks.push(d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ tapText: Buffer.concat(chunks).toString("utf8"), exitCode: code });
    });
  });

  return { metrics: [scoreTap(tapText, exitCode)] };
}

export function scoreTap(tapText, exitCode) {
  const parsed = parseTap(tapText);
  const tail = tapText.slice(-4000);
  if (!parsed.hasSummary) {
    throw new Error(`${TEST_FILE} produced no TAP summary, so nothing was measured. Output tail:\n${tail}`);
  }
  const { tests, pass, fail } = parsed.counts;
  if (tests !== EXPECTED_TESTS || pass + fail !== EXPECTED_TESTS) {
    throw new Error(
      `expected ${EXPECTED_TESTS} tests in ${TEST_FILE} to reach a verdict, got ${describeCounts(parsed.counts)}, ` +
        `so not every write path was exercised. Output tail:\n${tail}`
    );
  }
  if (fail === 0 && exitCode !== 0) {
    throw new Error(
      `${TEST_FILE} exited ${exitCode} with no failing test, which means a hook failed ` +
        `(fixture cleanup runs in one). Output tail:\n${tail}`
    );
  }
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
  // Self-test never has the opt-in, so it proves the skip path works
  // without touching a database. scoreTap's own cases are in
  // consent-scopes.test.mjs.
  run({ fixture: null, fixturePath: TEST_FILE, env: {}, log: console.log, now: () => new Date() })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      const metric = result.metrics[0];
      if (!metric.details.skipped) {
        console.error(`FAIL: expected a clean skip with no DATABASE_URL/${OPT_IN} set`);
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
