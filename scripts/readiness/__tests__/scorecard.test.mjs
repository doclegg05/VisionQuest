// Tests for the readiness scorecard CLI.
//
// Every CLI test runs against a throwaway root (READINESS_ROOT), so no test
// reads the real gates or writes into the real reports/ tree. None of them
// runs the scorecard on the real config: the T1 gate runs this file, so that
// would recurse.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCORECARD = join(HERE, "..", "scorecard.mjs");
const PROXY_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const lib = () => import("../parse.mjs");

const PASSING_TEST = `import test from "node:test";
test("adds up", () => {});
test("second case", () => {});
`;
const FAILING_TEST = `import test from "node:test";
import assert from "node:assert/strict";
test("holds", () => {});
test("breaks on purpose", () => { assert.equal(1, 2); });
`;
const CHECKLIST = `# Fixture checklist

## First table

| Check | How | Owner | Date | Result | Next action |
| --- | --- | --- | --- | --- | --- |
| Render region recorded | Dashboard | Britt | 2026-11-11 | verified | |
| Supabase region recorded | Dashboard | Britt | | not run | |
| Restore drill | Runbook | Britt | 2026-11-12 | failed | retry |
| Loose wording | Dashboard | Britt | | verified on Tuesday | |

## Second table, five columns

| Step | How | Owner | Date | Result |
| --- | --- | --- | --- | --- |
| 1. Keep the fence on | Render | Britt | 2026-11-11 | verified |
`;

function gate(id, check, over = {}) {
  return { id, kind: "task", set: "launch", title: `${id} title`, doneWhen: `${id} is done`, check, ...over };
}

function ownerGate(id, rows) {
  return gate(id, { type: "owner", doc: "docs/checklist.md", rows }, { kind: "owner" });
}

function metricGate(id, check) {
  const base = { type: "metric", baseline: 39, target: 20, direction: "atMost", unit: "queries" };
  return gate(id, { ...base, ...check }, { kind: "metric" });
}

/** A throwaway repo root holding the given gates and extra files. */
function makeRoot(t, gates, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "readiness-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "config", "readiness", "gates"), { recursive: true });
  for (const entry of gates) {
    writeFileSync(join(root, "config", "readiness", "gates", `${entry.id}.json`), JSON.stringify(entry, null, 2));
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function run(root, ...flags) {
  const env = { ...process.env, READINESS_ROOT: root };
  for (const name of PROXY_VARS) delete env[name];
  return spawnSync(process.execPath, [SCORECARD, ...flags], { encoding: "utf8", env });
}

/** Run with --json and return the gates keyed by id. */
function statuses(root, ...flags) {
  const result = run(root, "--json", "--no-write", ...flags);
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(JSON.parse(result.stdout).gates.map((entry) => [entry.id, entry]));
}

/** A loopback port with nothing listening on it. */
function closedPort() {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// --- check types ---

test("a pending check reports pending", (t) => {
  const root = makeRoot(t, [gate("A1", { type: "pending" })]);
  assert.equal(statuses(root).A1.status, "pending");
});

test("a test check passes when its tests pass", (t) => {
  const root = makeRoot(t, [gate("A1", { type: "test", files: ["checks/ok.test.mjs"] })], {
    "checks/ok.test.mjs": PASSING_TEST,
  });
  const got = statuses(root).A1;
  assert.equal(got.status, "pass");
  assert.match(got.detail, /2 tests passed/);
});

test("a test check fails when a test fails, and names it", (t) => {
  const root = makeRoot(t, [gate("A1", { type: "test", files: ["checks/bad.test.mjs"] })], {
    "checks/bad.test.mjs": FAILING_TEST,
  });
  const got = statuses(root).A1;
  assert.equal(got.status, "fail");
  assert.match(got.detail, /breaks on purpose/);
});

test("a test check whose name pattern matches no test fails with 'no test matched'", (t) => {
  // Node exits 0 here and reports the file itself as one passing test, so the
  // exit code and the `# pass` count both look green.
  const check = { type: "test", files: ["checks/ok.test.mjs"], namePattern: "no such test name" };
  const root = makeRoot(t, [gate("A1", check)], { "checks/ok.test.mjs": PASSING_TEST });
  const got = statuses(root).A1;
  assert.equal(got.status, "fail");
  assert.equal(got.detail, "no test matched");
});

test("a test file under a folder named like a route segment, [id], still runs", (t) => {
  // node --test reads its file arguments as globs, so "[id]" is a character
  // class: the path matched nothing, ran 0 tests and exited 0.
  const check = { type: "test", files: ["checks/[id]/ok.test.mjs"] };
  const root = makeRoot(t, [gate("A1", check)], { "checks/[id]/ok.test.mjs": PASSING_TEST });
  const got = statuses(root).A1;
  assert.equal(got.status, "pass");
  assert.match(got.detail, /2 tests passed/);
});

test("a test check with a name pattern runs only the matching test", (t) => {
  const check = { type: "test", files: ["checks/ok.test.mjs"], namePattern: "adds up" };
  const root = makeRoot(t, [gate("A1", check)], { "checks/ok.test.mjs": PASSING_TEST });
  const got = statuses(root).A1;
  assert.equal(got.status, "pass");
  assert.match(got.detail, /1 test passed/);
});

test("a test check that names a missing file fails", (t) => {
  const root = makeRoot(t, [gate("A1", { type: "test", files: ["checks/gone.test.mjs"] })]);
  const got = statuses(root).A1;
  assert.equal(got.status, "fail");
  assert.match(got.detail, /missing test file: checks\/gone\.test\.mjs/);
});

test("a command check passes on exit 0", (t) => {
  const root = makeRoot(t, [gate("A1", { type: "command", run: `node -e "process.exit(0)"` })]);
  assert.equal(statuses(root).A1.status, "pass");
});

test("a command check fails on a non-zero exit and quotes the last line", (t) => {
  const command = `node -e "console.error('lint broke'); process.exit(3)"`;
  const root = makeRoot(t, [gate("A1", { type: "command", run: command })]);
  const got = statuses(root).A1;
  assert.equal(got.status, "fail");
  assert.match(got.detail, /exit 3.*lint broke/);
});

test("a metric with no command is unmeasured", (t) => {
  const root = makeRoot(t, [metricGate("M1", { run: null })]);
  assert.equal(statuses(root).M1.status, "unmeasured");
});

test("a metric reads the number on the last line and passes at an atMost target", (t) => {
  const command = `node -e "console.log('a table line'); console.log(20)"`;
  const root = makeRoot(t, [metricGate("M1", { run: command })]);
  const got = statuses(root).M1;
  assert.equal(got.status, "pass");
  assert.match(got.detail, /20 queries/);
});

test("a metric over an atMost target fails", (t) => {
  const root = makeRoot(t, [metricGate("M1", { run: `node -e "console.log(20.5)"` })]);
  assert.equal(statuses(root).M1.status, "fail");
});

test("a metric under an atLeast target fails", (t) => {
  const check = { run: `node -e "console.log(19)"`, direction: "atLeast" };
  const root = makeRoot(t, [metricGate("M1", check)]);
  assert.equal(statuses(root).M1.status, "fail");
});

test("a metric whose command prints no number fails", (t) => {
  const root = makeRoot(t, [metricGate("M1", { run: `node -e "console.log('not a number')"` })]);
  const got = statuses(root).M1;
  assert.equal(got.status, "fail");
  assert.match(got.detail, /no number/);
});

test("a metric that prints Infinity fails, even against an atLeast target", (t) => {
  const check = { run: `node -e "console.log(Infinity)"`, direction: "atLeast" };
  const root = makeRoot(t, [metricGate("M1", check)]);
  assert.equal(statuses(root).M1.status, "fail");
});

test("a metric that prints a hex literal fails instead of being read as a number", (t) => {
  const root = makeRoot(t, [metricGate("M1", { run: `node -e "console.log('0x10')"` })]);
  assert.equal(statuses(root).M1.status, "fail");
});

// --- needs: ci and needs: network ---

test("a check that needs CI reports needs-ci and is not run", (t) => {
  const marker = `import { writeFileSync } from "node:fs";\nwriteFileSync("ran.txt", "x");\n${PASSING_TEST}`;
  const check = { type: "test", files: ["checks/db.test.mjs"], needs: "ci" };
  const root = makeRoot(t, [gate("A1", check)], { "checks/db.test.mjs": marker });
  assert.equal(statuses(root).A1.status, "needs-ci");
  assert.equal(existsSync(join(root, "ran.txt")), false);
});

test("needs: ci on a check that is not a test is a config error, so --ci-green cannot pass it", (t) => {
  const root = makeRoot(t, [gate("A1", { type: "command", run: "exit 1", needs: "ci" })]);
  const result = run(root, "--ci-green=123", "--no-write");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /only valid on a test check/);
});

test("--ci-green passes a needs-ci check whose test files exist, and says the flag was used", (t) => {
  const check = { type: "test", files: ["checks/db.test.mjs"], needs: "ci" };
  const root = makeRoot(t, [gate("A1", check)], { "checks/db.test.mjs": FAILING_TEST });
  const result = run(root, "--ci-green=19283746", "--no-write");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^A1\s+launch\s+pass\b/m);
  assert.match(result.stdout, /CI run 19283746/);
  assert.match(result.stdout, /--ci-green was used/);
});

test("--ci-green without a CI run to name is a usage error", (t) => {
  const check = { type: "test", files: ["checks/db.test.mjs"], needs: "ci" };
  const root = makeRoot(t, [gate("A1", check)], { "checks/db.test.mjs": PASSING_TEST });
  const result = run(root, "--ci-green", "--no-write");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--ci-green needs a value/);
});

test("a pass taken from CI is marked in the written report, with the run it came from", (t) => {
  const check = { type: "test", files: ["checks/db.test.mjs"], needs: "ci" };
  const root = makeRoot(t, [gate("A1", check), gate("A2", { type: "command", run: "exit 0" })], {
    "checks/db.test.mjs": PASSING_TEST,
  });
  assert.equal(run(root, "--ci-green=19283746").status, 0);
  const report = JSON.parse(readFileSync(join(root, "reports", "readiness", "latest.json"), "utf8"));
  const [a1, a2] = report.gates;
  assert.equal(report.ciGreen, "19283746");
  assert.equal(a1.via, "ci");
  assert.match(a1.detail, /CI run 19283746/);
  assert.equal(a2.via, undefined);
});

test("--ci-green fails a needs-ci check whose test file is missing", (t) => {
  const check = { type: "test", files: ["checks/gone.test.mjs"], needs: "ci" };
  const root = makeRoot(t, [gate("A1", check)]);
  const got = statuses(root, "--ci-green=19283746").A1;
  assert.equal(got.status, "fail");
  assert.match(got.detail, /missing test file/);
});

test("a network check that cannot connect is unmeasured, not failed", async (t) => {
  const port = await closedPort();
  const command = `node -e "fetch('http://127.0.0.1:${port}/').then((r) => r.text()).then((body) => console.log(body.length))"`;
  const root = makeRoot(t, [
    metricGate("M1", { run: command, needs: "network" }),
    gate("A1", { type: "command", run: command, needs: "network" }),
  ]);
  const got = statuses(root);
  assert.equal(got.M1.status, "unmeasured");
  assert.equal(got.A1.status, "unmeasured");
});

test("a network check that fails for another reason still fails", (t) => {
  const command = `node -e "console.error('bad parse'); process.exit(1)"`;
  const root = makeRoot(t, [gate("A1", { type: "command", run: command, needs: "network" })]);
  assert.equal(statuses(root).A1.status, "fail");
});

// --- owner rows ---

test("an owner gate passes when every named row reads verified, in either table layout", (t) => {
  const rows = ["Render region recorded", "1. Keep the fence on"];
  const root = makeRoot(t, [ownerGate("O-1", rows)], { "docs/checklist.md": CHECKLIST });
  const got = statuses(root)["O-1"];
  assert.equal(got.status, "pass");
  assert.match(got.detail, /2 of 2 rows verified/);
});

test("an owner gate with a row that is not run stays owner-open", (t) => {
  const rows = ["Render region recorded", "Supabase region recorded"];
  const root = makeRoot(t, [ownerGate("O-1", rows)], { "docs/checklist.md": CHECKLIST });
  const got = statuses(root)["O-1"];
  assert.equal(got.status, "owner-open");
  assert.match(got.detail, /1 of 2 rows verified/);
});

test("an owner gate that names a row the checklist lacks fails", (t) => {
  const rows = ["Render region recorded", "No such row"];
  const root = makeRoot(t, [ownerGate("O-1", rows)], { "docs/checklist.md": CHECKLIST });
  const got = statuses(root)["O-1"];
  assert.equal(got.status, "fail");
  assert.match(got.detail, /row not found: No such row/);
});

test("an owner gate with a row that reads failed fails", (t) => {
  const root = makeRoot(t, [ownerGate("O-1", ["Restore drill"])], { "docs/checklist.md": CHECKLIST });
  assert.equal(statuses(root)["O-1"].status, "fail");
});

test("a result that is not exactly `verified` does not pass", (t) => {
  const root = makeRoot(t, [ownerGate("O-1", ["Loose wording"])], { "docs/checklist.md": CHECKLIST });
  assert.equal(statuses(root)["O-1"].status, "owner-open");
});

// --- --strict ---

test("--strict exits 1 when a launch gate is not pass", (t) => {
  const root = makeRoot(t, [
    gate("A1", { type: "command", run: `node -e "process.exit(0)"` }),
    gate("A2", { type: "pending" }),
  ]);
  const result = run(root, "--strict", "--no-write");
  // The table must be there too: a crash also exits 1.
  assert.match(result.stdout, /^A2\s+launch\s+pending\b/m);
  assert.equal(result.status, 1);
});

test("without --strict a launch gate that is not pass still exits 0", (t) => {
  const root = makeRoot(t, [gate("A2", { type: "pending" })]);
  assert.equal(run(root, "--no-write").status, 0);
});

test("--strict exits 0 when every launch gate passes, whatever a pilot gate does", (t) => {
  const root = makeRoot(t, [
    gate("A1", { type: "command", run: `node -e "process.exit(0)"` }),
    gate("B1", { type: "pending" }, { set: "pilot" }),
  ]);
  assert.equal(run(root, "--strict", "--no-write").status, 0);
});

// --- usage and config errors ---

test("an unknown flag is a usage error", (t) => {
  const root = makeRoot(t, [gate("A1", { type: "pending" })]);
  const result = run(root, "--nope");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown flag: --nope/);
});

test("a gate file that is not valid JSON is a config error", (t) => {
  const root = makeRoot(t, [], { "config/readiness/gates/A1.json": "{ not json" });
  const result = run(root, "--no-write");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /A1\.json/);
});

test("two files with one id are a config error", (t) => {
  const root = makeRoot(t, [gate("A1", { type: "pending" })], {
    "config/readiness/gates/A1-copy.json": JSON.stringify(gate("A1", { type: "pending" })),
  });
  const result = run(root, "--no-write");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /duplicate id A1/);
});

test("a gate whose id does not match its file name is a config error", (t) => {
  const root = makeRoot(t, [], {
    "config/readiness/gates/B7.json": JSON.stringify(gate("A1", { type: "pending" })),
  });
  const result = run(root, "--no-write");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /A1 has no file A1\.json/);
});

test("--only with an id that has no gate file is a config error", (t) => {
  const root = makeRoot(t, [gate("A1", { type: "pending" })]);
  const result = run(root, "--only=A1,Z9", "--no-write");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Z9/);
});

test("a check type the scorecard does not know is a config error", (t) => {
  const root = makeRoot(t, [gate("A1", { type: "vibes" })]);
  assert.equal(run(root, "--no-write").status, 2);
});

// --- output ---

const MIXED = (t) =>
  makeRoot(
    t,
    [
      gate("A1", { type: "command", run: `node -e "process.exit(0)"` }),
      gate("A2", { type: "pending" }),
      gate("B1", { type: "pending" }, { set: "pilot" }),
      gate("F7", { type: "pending" }, { set: "hold" }),
      metricGate("M1", { run: null }),
      ownerGate("O-1", ["Supabase region recorded"]),
    ],
    { "docs/checklist.md": CHECKLIST }
  );

test("the output has one row per gate and a score line per group", (t) => {
  const { stdout } = run(MIXED(t), "--no-write");
  for (const id of ["A1", "A2", "B1", "F7", "M1", "O-1"]) assert.match(stdout, new RegExp(`^${id}\\s`, "m"));
  assert.match(stdout, /^Launch tasks: 1\/2$/m);
  assert.match(stdout, /^Launch metrics: 0\/1$/m);
  assert.match(stdout, /^Owner rows: 0\/1$/m);
  assert.match(stdout, /^Pilot tasks: 0\/1$/m);
});

test("owner rows print in their own block, after the other gates", (t) => {
  const lines = run(MIXED(t), "--no-write").stdout.split("\n");
  const heading = lines.findIndex((line) => line.startsWith("Owner track"));
  assert.ok(heading > lines.findIndex((line) => /^M1\s/.test(line)), "heading comes after the metric rows");
  assert.ok(lines.findIndex((line) => /^O-1\s/.test(line)) > heading, "the owner row sits under the heading");
});

test("the report is written as Markdown and JSON, with no dash other than a hyphen", (t) => {
  const root = MIXED(t);
  assert.equal(run(root).status, 0);
  const markdown = readFileSync(join(root, "reports", "readiness", "latest.md"), "utf8");
  assert.match(markdown, /^\| A1 \| launch \| pass \|/m);
  assert.match(markdown, /^Launch tasks: 1\/2$/m);
  assert.doesNotMatch(markdown, /[\u2012-\u2015]/);
  const report = JSON.parse(readFileSync(join(root, "reports", "readiness", "latest.json"), "utf8"));
  assert.equal(report.gates.length, 6);
});

test("--no-write leaves reports/ alone", (t) => {
  const root = MIXED(t);
  const result = run(root, "--no-write");
  assert.match(result.stdout, /^Launch tasks: 1\/2$/m);
  assert.equal(existsSync(join(root, "reports")), false);
});

test("a subset run leaves the written report alone, so latest.* always holds every gate", (t) => {
  const root = MIXED(t);
  const latest = () => readFileSync(join(root, "reports", "readiness", "latest.json"), "utf8");
  assert.equal(run(root).status, 0);
  const full = latest();
  for (const flag of ["--only=A1", "--set=launch"]) {
    const subset = run(root, flag);
    assert.equal(subset.status, 0, subset.stderr);
    assert.match(subset.stdout, /^A1\s+launch\s+pass\b/m);
    assert.match(subset.stderr, /reports not written/);
    assert.equal(latest(), full, `${flag} rewrote the report`);
  }
});

test("--set=launch leaves out pilot and hold gates", (t) => {
  assert.deepEqual(Object.keys(statuses(MIXED(t), "--set=launch")).sort(), ["A1", "A2", "M1", "O-1"]);
});

test("--only runs just the named gates", (t) => {
  assert.deepEqual(Object.keys(statuses(MIXED(t), "--only=A2,M1")).sort(), ["A2", "M1"]);
});

// --- the unit-suite rule behind --with-base ---

const ROOT = "/repo";
const KNOWN = [{ file: "src/lib/a.test.ts", name: "stages a bundled PDF", reason: "spawns the tsx CLI" }];

/** TAP in Node's shape: a failing test inside a suite, then `extra`. */
function unitTap(extra = "") {
  return `TAP version 13
# Subtest: standalone asset staging
    # Subtest: stages a bundled PDF
    not ok 1 - stages a bundled PDF
      ---
      type: 'test'
      location: '${ROOT}/src/lib/a.test.ts:79:3'
      failureType: 'testCodeFailure'
      error: |-
        not ok 9 - a line inside an error block is not a test
      ...
    1..1
not ok 1 - standalone asset staging
  ---
  type: 'suite'
  location: '${ROOT}/src/lib/a.test.ts:71:1'
  failureType: 'subtestsFailed'
  ...
# Subtest: passes
ok 2 - passes
  ---
  type: 'test'
  ...
${extra}1..2
`;
}

function failing(name, file) {
  return `not ok 3 - ${name}
  ---
  type: 'test'
  location: '${ROOT}/${file}:5:1'
  failureType: 'testCodeFailure'
  ...
`;
}

test("the unit suite passes when every failing test is a known sandbox failure", async () => {
  const { judgeUnitSuite, parseTap } = await lib();
  const verdict = judgeUnitSuite(parseTap(unitTap(), ROOT), 1, KNOWN);
  assert.equal(verdict.status, "pass");
  assert.match(verdict.detail, /1 passed, 1 known sandbox-only failure/);
});

test("the unit suite fails when a failing test is not on the known list, and names it", async () => {
  const { judgeUnitSuite, parseTap } = await lib();
  const tap = parseTap(unitTap(failing("a third failure", "src/lib/b.test.ts")), ROOT);
  const verdict = judgeUnitSuite(tap, 1, KNOWN);
  assert.equal(verdict.status, "fail");
  assert.match(verdict.detail, /1 unexpected.*src\/lib\/b\.test\.ts: a third failure/);
});

test("a known test name failing in a different file is not excused", async () => {
  const { judgeUnitSuite, parseTap } = await lib();
  const tap = parseTap(unitTap(failing("stages a bundled PDF", "src/lib/other.test.ts")), ROOT);
  assert.equal(judgeUnitSuite(tap, 1, KNOWN).status, "fail");
});

test("the unit suite fails when no test passed", async () => {
  const { judgeUnitSuite, parseTap } = await lib();
  assert.equal(judgeUnitSuite(parseTap("TAP version 13\n1..0\n", ROOT), 0, KNOWN).status, "fail");
});

test("the unit suite fails on a non-zero exit that no failing test explains", async () => {
  const { judgeUnitSuite, parseTap } = await lib();
  const tap = parseTap("TAP version 13\nok 1 - passes\n  ---\n  type: 'test'\n  ...\n1..1\n", ROOT);
  const verdict = judgeUnitSuite(tap, 7, KNOWN);
  assert.equal(verdict.status, "fail");
  assert.match(verdict.detail, /exit 7/);
});

test("parseTap does not count the file-level entry Node prints when no test in a file ran", async () => {
  const { parseTap } = await lib();
  const self = fileURLToPath(import.meta.url);
  const tap = parseTap(`TAP version 13\n1..0\n# Subtest: ${self}\nok 1 - ${self}\n  ---\n  type: 'test'\n  ...\n1..1\n`, ROOT);
  assert.equal(tap.passed.length, 0);
});

test("parseTap does not count a skipped test as passed", async () => {
  const { parseTap } = await lib();
  const tap = parseTap("TAP version 13\nok 1 - later # SKIP\n  ---\n  type: 'test'\n  ...\n1..1\n", ROOT);
  assert.equal(tap.passed.length, 0);
});

test("a missing known-failures file is a config error, not a crash", (t) => {
  const root = makeRoot(t, [gate("A1", { type: "pending" })]);
  const result = run(root, "--with-base", "--only=BASE-unit", "--no-write");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /sandbox-known-failures\.json/);
});

test("nothing is excused in CI, where the sandbox-only tests really run", async () => {
  const { excusable } = await lib();
  assert.deepEqual(excusable(KNOWN, { CI: "true" }), []);
  assert.deepEqual(excusable(KNOWN, {}), KNOWN);
});

test("the report marks a commit with uncommitted changes as dirty", (t) => {
  const root = makeRoot(t, [gate("A1", { type: "pending" })]);
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "base");
  const report = JSON.parse(run(root, "--json", "--no-write").stdout);
  assert.match(report.commit, /^[0-9a-f]{7,}-dirty$/);
});
