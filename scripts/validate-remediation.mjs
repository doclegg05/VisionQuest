#!/usr/bin/env node
/**
 * Remediation gate for the 2026-07-24 review's critical/high findings.
 *
 * Prints `RESOLVED: <n>/29` and exits 0 only when every finding is resolved
 * with a verification that actually checks out AND the unit suite is green.
 *
 * Contract (FROZEN once this is a goal's Proof — findings adapt to the gate,
 * never the reverse):
 *
 *   Ledger: config/remediation-ledger.json
 *   Every finding carries id / area / severity / title / status.
 *   status is one of:
 *     "open"      — not addressed. Any open finding fails the gate.
 *     "fixed"     — must carry >=1 verification entry, each of which passes.
 *     "deferred"  — must carry `reason` and `deferredAt`. Capped by
 *                   ledger.maxDeferred so the gate cannot be satisfied by
 *                   deferring everything.
 *
 *   Verification kinds (each must name a real, checkable artifact):
 *     { kind: "test",   file, mustContain? }  file exists; contains the finding
 *                                            id (so a regression test names it)
 *                                            and any extra string given
 *     { kind: "ci",     file, mustContain }   workflow/config contains a string
 *     { kind: "script", name }                package.json script exists
 *     { kind: "config", file, mustContain }   source/config contains a string
 *     { kind: "doc",    file, mustContain }   doc contains a string
 *
 * Flags:
 *   --skip-tests   structure/verification checks only; does NOT run the suite.
 *                  Use while iterating. The Proof run must omit it.
 *
 * Exit 0 = PASS, exit 1 = FAIL with itemized reasons.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER_PATH = join(ROOT, "config", "remediation-ledger.json");
const EXPECTED_COUNT = 29;
const VALID_STATUS = new Set(["open", "fixed", "deferred"]);
const VALID_SEVERITY = new Set(["critical", "high"]);
const SKIP_TESTS = process.argv.includes("--skip-tests");

function readFileIfPresent(relPath) {
  const abs = join(ROOT, relPath);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
}

function checkVerification(entry, v, failures) {
  const label = `${entry.id} verification[${v.kind ?? "?"}]`;

  if (v.kind === "script") {
    if (!v.name) return failures.push(`${label}: missing "name"`);
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    if (!pkg.scripts || !Object.hasOwn(pkg.scripts, v.name)) {
      failures.push(`${label}: package.json has no script "${v.name}"`);
    }
    return undefined;
  }

  if (!["test", "ci", "config", "doc"].includes(v.kind)) {
    return failures.push(`${label}: unknown kind "${v.kind}"`);
  }
  if (!v.file) return failures.push(`${label}: missing "file"`);
  if (v.file.startsWith("/") || v.file.includes("..")) {
    return failures.push(`${label}: file "${v.file}" must be repo-relative with no traversal`);
  }

  const content = readFileIfPresent(v.file);
  if (content === null) {
    return failures.push(`${label}: file "${v.file}" does not exist`);
  }

  // A `test` verification must name the finding id, so the regression test is
  // traceable to the finding it closes.
  if (v.kind === "test" && !content.includes(entry.id)) {
    failures.push(`${label}: "${v.file}" does not mention ${entry.id} — name the finding in the test`);
  }
  const needles = v.kind === "test" ? (v.mustContain ? [v.mustContain] : []) : [v.mustContain];
  for (const needle of needles) {
    if (!needle) {
      failures.push(`${label}: kind "${v.kind}" requires "mustContain"`);
      continue;
    }
    if (!content.includes(needle)) {
      failures.push(`${label}: "${v.file}" does not contain ${JSON.stringify(needle)}`);
    }
  }
  return undefined;
}

function checkLedger() {
  if (!existsSync(LEDGER_PATH)) {
    return { failures: [`ledger not found at ${LEDGER_PATH}`], summary: null };
  }

  let ledger;
  try {
    ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  } catch (err) {
    return { failures: [`ledger is not valid JSON: ${err.message}`], summary: null };
  }

  const failures = [];
  const findings = Array.isArray(ledger.findings) ? ledger.findings : [];
  const maxDeferred = Number.isInteger(ledger.maxDeferred) ? ledger.maxDeferred : 0;

  if (findings.length !== EXPECTED_COUNT) {
    failures.push(`ledger has ${findings.length} findings; expected ${EXPECTED_COUNT}`);
  }

  const seen = new Set();
  const counts = { open: 0, fixed: 0, deferred: 0 };

  for (const [i, entry] of findings.entries()) {
    const where = entry.id ?? `index ${i}`;
    for (const field of ["id", "area", "severity", "title", "status"]) {
      if (!entry[field]) failures.push(`${where}: missing "${field}"`);
    }
    if (entry.id) {
      if (seen.has(entry.id)) failures.push(`${where}: duplicate id`);
      seen.add(entry.id);
      if (!/^VQ-R-\d{3}$/.test(entry.id)) failures.push(`${where}: id must match VQ-R-000`);
    }
    if (entry.severity && !VALID_SEVERITY.has(entry.severity)) {
      failures.push(`${where}: severity "${entry.severity}" must be critical or high`);
    }
    if (!VALID_STATUS.has(entry.status)) {
      failures.push(`${where}: status "${entry.status}" must be open, fixed or deferred`);
      continue;
    }

    counts[entry.status] += 1;

    if (entry.status === "fixed") {
      const vs = Array.isArray(entry.verification) ? entry.verification : [];
      if (vs.length === 0) {
        failures.push(`${where}: status fixed requires at least one verification entry`);
      }
      for (const v of vs) checkVerification(entry, v, failures);
    }

    if (entry.status === "deferred") {
      if (!entry.reason) failures.push(`${where}: status deferred requires "reason"`);
      if (!entry.deferredAt) failures.push(`${where}: status deferred requires "deferredAt"`);
    }
  }

  if (counts.open > 0) {
    const openIds = findings.filter((f) => f.status === "open").map((f) => f.id).join(", ");
    failures.push(`${counts.open} finding(s) still open: ${openIds}`);
  }
  if (counts.deferred > maxDeferred) {
    failures.push(`${counts.deferred} deferred exceeds maxDeferred ${maxDeferred}`);
  }

  const resolved = counts.fixed + counts.deferred;
  return { failures, summary: { ...counts, resolved, total: findings.length, maxDeferred } };
}

function runSuite(failures) {
  console.log("\nrunning unit suite (npm test)...");
  const res = spawnSync("npm", ["test"], { cwd: ROOT, encoding: "utf8", shell: false });
  if (res.status !== 0) {
    const tail = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim().split("\n").slice(-15).join("\n");
    failures.push(`npm test failed (exit ${res.status}). Tail:\n${tail}`);
    return;
  }
  const line = (res.stdout ?? "").split("\n").find((l) => l.startsWith("# pass") || l.includes("ℹ pass"));
  console.log(`  suite green${line ? ` — ${line.trim()}` : ""}`);
}

function main() {
  console.log(`remediation:gate — ${LEDGER_PATH}`);
  const { failures, summary } = checkLedger();

  if (summary) {
    console.log(`  fixed: ${summary.fixed}  deferred: ${summary.deferred} (max ${summary.maxDeferred})  open: ${summary.open}`);
    console.log(`RESOLVED: ${summary.resolved}/${summary.total}`);
  }

  const allResolved = summary && summary.open === 0 && failures.length === 0;
  if (allResolved && !SKIP_TESTS) runSuite(failures);
  else if (allResolved && SKIP_TESTS) console.log("\n(--skip-tests: unit suite NOT run; the Proof run must omit this flag)");

  if (failures.length > 0) {
    console.error(`\nFAIL — ${failures.length} problem(s):`);
    failures.forEach((f) => console.error(`  ✗ ${f}`));
    process.exitCode = 1;
    return;
  }

  console.log("\nPASS — every critical/high finding is resolved and verified.");
}

main();
