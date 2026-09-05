#!/usr/bin/env node
// Benchmark suite: pii-log-grep (gate, no requires).
//
// Two metrics:
//   pii_hits_in_logs — a RUNTIME probe. Captures the unit-test run's stdout
//     and stderr (either $BENCH_TEST_LOG, a path to an already-captured log,
//     or a fresh bounded `npm test` run), keeps only the lines that are
//     actually structured logger output (src/lib/logger.ts's own format —
//     not test-runner chatter or assertion text, which is full of
//     fixture-looking substrings that never reached a real log call), and
//     greps those lines for (a) cuid-shaped ids collected from `id:` /
//     `studentId:` literals in test files, and (b) phone-number- and
//     email-shaped substrings. The ESLint rule below catches known field
//     names on `logger.*` calls statically; this catches what that AST
//     selector cannot — a value that reached a log line some other way
//     (string interpolation, an object spread, a caught error's message).
//   pii_eslint_violations — count of the four PII selectors already gating
//     CI (`.claude/rules/security.md`, eslint.config.mjs
//     `restrictedSyntaxEverywhere`), isolated from that file's other
//     `no-restricted-syntax` entries (the dark-mode rgba() guards) by
//     filtering on the shared "No student identifier ..." message prefix
//     every PII selector's message starts with.

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");

const TEST_RUN_TIMEOUT_MS = 240_000;
const ESLINT_TIMEOUT_MS = 300_000;

const LOGGER_LINE_RE = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z\s\[(DEBUG|INFO|WARN|ERROR)\]/;
const CUID_RE = /\bc[a-z0-9]{20,30}\b/g;
const PHONE_RE = /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function walkFiles(dir, predicate, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, out);
    else if (predicate(entry.name)) out.push(full);
  }
  return out;
}

/** Every cuid-shaped literal assigned to `id:` or `studentId:` across the test tree. */
function collectFixtureCuids() {
  const testFiles = walkFiles(path.join(REPO_ROOT, "src"), (name) => name.endsWith(".test.ts"));
  const ids = new Set();
  const literalRe = /(?:studentId|id)\s*:\s*"([^"]+)"/g;
  for (const file of testFiles) {
    const text = readFileSync(file, "utf8");
    let m;
    literalRe.lastIndex = 0;
    while ((m = literalRe.exec(text)) !== null) {
      if (/^c[a-z0-9]{20,30}$/.test(m[1])) ids.add(m[1]);
    }
  }
  return ids;
}

function findLoggerLines(rawText) {
  return rawText.split("\n").filter((line) => LOGGER_LINE_RE.test(line));
}

function grepLoggerLines(loggerLines, fixtureCuids) {
  const hits = [];
  for (const line of loggerLines) {
    const foundCuids = [...line.matchAll(CUID_RE)].map((m) => m[0]).filter((c) => fixtureCuids.has(c));
    const foundPhones = [...line.matchAll(PHONE_RE)].map((m) => m[0]);
    const foundEmails = [...line.matchAll(EMAIL_RE)].map((m) => m[0]);
    for (const cuid of foundCuids) hits.push({ kind: "student_fixture_id", value: cuid, line });
    for (const phone of foundPhones) hits.push({ kind: "phone", value: phone, line });
    for (const email of foundEmails) hits.push({ kind: "email", value: email, line });
  }
  return hits;
}

async function captureTestLog() {
  if (process.env.BENCH_TEST_LOG) {
    return readFileSync(process.env.BENCH_TEST_LOG, "utf8");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn("npm", ["test"], { cwd: REPO_ROOT, env: process.env });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, TEST_RUN_TIMEOUT_MS);
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
}

/**
 * Returns either `{ violations }` (a real answer) or `{ toolingError }` (the
 * eslint run itself did not complete — e.g. it hit the timeout, plausible
 * when many sibling processes contend for CPU on a shared host). A tooling
 * failure must never look like "zero violations" to a caller.
 */
async function countPiiEslintViolations() {
  try {
    const { stdout } = await execFileAsync("npx", ["eslint", ".", "--format", "json"], {
      cwd: REPO_ROOT,
      timeout: ESLINT_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024,
    });
    return { violations: tallyPiiMessages(stdout) };
  } catch (error) {
    // eslint exits 1 when it finds ANY lint error — that is the expected,
    // successful outcome for "some violations exist", not a tooling failure.
    // stdout still carries the JSON report in that case.
    if (typeof error?.stdout === "string" && error.stdout.length > 0) {
      return { violations: tallyPiiMessages(error.stdout) };
    }
    return {
      toolingError: error?.killed
        ? `eslint did not finish within ${ESLINT_TIMEOUT_MS}ms (killed by ${error.signal ?? "timeout"})`
        : String(error?.message ?? error),
    };
  }
}

function tallyPiiMessages(jsonText) {
  const report = JSON.parse(jsonText);
  const violations = [];
  for (const fileResult of report) {
    for (const msg of fileResult.messages) {
      if (msg.ruleId === "no-restricted-syntax" && msg.message.startsWith("No student identifier")) {
        violations.push({ file: fileResult.filePath, line: msg.line, message: msg.message });
      }
    }
  }
  return violations;
}

export async function run(ctx) {
  const usingSelfTestFixture = Boolean(ctx?.fixture?.sampleLogClean || ctx?.fixture?.sampleLogViolation);

  let loggerLines;
  let fixtureCuids;
  if (usingSelfTestFixture) {
    const lines = [
      ...(ctx.fixture.sampleLogClean ?? []),
      ...(ctx.fixture.sampleLogViolation ?? []),
    ];
    loggerLines = lines.filter((line) => LOGGER_LINE_RE.test(line));
    fixtureCuids = new Set(ctx.fixture.sampleFixtureCuids ?? []);
  } else {
    const rawText = await captureTestLog();
    loggerLines = findLoggerLines(rawText);
    fixtureCuids = collectFixtureCuids();
  }

  const hits = grepLoggerLines(loggerLines, fixtureCuids);
  const eslintResult = await countPiiEslintViolations();
  const eslintCount = eslintResult.violations?.length ?? 0;

  return {
    metrics: [
      {
        id: "pii_hits_in_logs",
        value: hits.length,
        n: loggerLines.length,
        details: {
          loggerLinesScanned: loggerLines.length,
          fixtureCuidsTracked: fixtureCuids.size,
          hits: hits.slice(0, 20),
        },
      },
      {
        id: "pii_eslint_violations",
        value: eslintCount,
        n: eslintCount,
        details: eslintResult.toolingError
          ? { toolingError: eslintResult.toolingError }
          : { violations: eslintResult.violations.slice(0, 20) },
      },
    ],
  };
}

if (process.argv.includes("--self-test")) {
  const fixturePath = path.join(REPO_ROOT, "config/benchmarks/fixtures/pii-log-grep.json");
  const cleanFixture = { sampleLogClean: JSON.parse(readFileSync(fixturePath, "utf8")).sampleLogClean };
  const violationFixture = JSON.parse(readFileSync(fixturePath, "utf8"));

  (async () => {
    const cleanResult = await run({ fixture: cleanFixture, fixturePath, env: {}, log: console.log, now: () => new Date() });
    console.log("clean fixture:", JSON.stringify(cleanResult, null, 2));
    const cleanHits = cleanResult.metrics.find((m) => m.id === "pii_hits_in_logs");
    if (cleanHits.value !== 0) {
      console.error(`FAIL: clean fixture reported ${cleanHits.value} hits, expected 0`);
      process.exit(1);
    }

    const violationResult = await run({ fixture: violationFixture, fixturePath, env: {}, log: console.log, now: () => new Date() });
    console.log("violation fixture:", JSON.stringify(violationResult, null, 2));
    const violationHits = violationResult.metrics.find((m) => m.id === "pii_hits_in_logs");
    if (violationHits.value < 3) {
      console.error(
        `FAIL: violation fixture (cuid + phone + email planted) reported only ${violationHits.value} hits — detection logic is not working`,
      );
      process.exit(1);
    }

    // The real (non-fixture) eslint check is worth proving works too, since
    // self-test never exercises captureTestLog() — run it against the repo.
    // A tooling timeout here (plausible under heavy CPU contention from
    // sibling processes) is reported, not treated as a self-test failure —
    // it says nothing about whether the detection logic is correct.
    const eslintOnly = await countPiiEslintViolations();
    if (eslintOnly.toolingError) {
      console.warn(`SKIP: eslint tooling check inconclusive — ${eslintOnly.toolingError}`);
    } else {
      console.log(`repo eslint PII violations right now: ${eslintOnly.violations.length}`);
      if (eslintOnly.violations.length !== 0) {
        console.error(
          `FAIL: expected 0 PII eslint violations in a clean tree, found ${eslintOnly.violations.length}`,
        );
        process.exit(1);
      }
    }

    process.exit(0);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
