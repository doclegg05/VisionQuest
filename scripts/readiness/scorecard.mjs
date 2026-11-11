#!/usr/bin/env node
/**
 * Readiness scorecard for docs/plans/2026-11-10-deployment-readiness.md.
 *
 *   npm run readiness -- [--set=launch|pilot|all] [--only=ID,ID] [--strict]
 *                        [--ci-green=<CI run>] [--with-base] [--json] [--no-write]
 *
 * Reads one gate per file from config/readiness/gates/, runs each gate's
 * check, prints one row per gate and the scores, and writes
 * reports/readiness/latest.md and latest.json unless --no-write. A subset run
 * (--only, or --set other than all) never writes: latest.* holds every gate.
 *
 * Statuses: pass, fail, pending (no check exists yet), needs-ci (the check
 * needs a database or a browser), owner-open (a checklist row is not yet
 * `verified`), unmeasured (a metric with no command, or a network check that
 * could not connect). Only `pass` adds to a score.
 *
 * --ci-green=<CI run> counts a `needs: "ci"` test check as pass when its test
 * files exist. It names the green CI run it relies on, and each such row is
 * marked `via: "ci"` with that run, so a pass that did not run here is never
 * mistaken for one that did. Outside the sandbox (CI sets `CI`), the unit
 * suite excuses nothing.
 * --with-base adds typecheck, lint and the whole unit suite (minutes).
 *
 * Exit codes: 0 normally; 1 with --strict when a Launch gate is not `pass`;
 * 2 for a usage or config error.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { excusable, judgeUnitSuite, parseChecklist, parseTap, plural, verdict } from "./parse.mjs";

const GATES_DIR = "config/readiness/gates";
const KNOWN_FAILURES = "config/readiness/sandbox-known-failures.json";
const REPORT_DIR = "reports/readiness";
const KINDS = ["base", "task", "metric", "owner"];
const SETS = ["launch", "pilot", "hold"];
const CHECK_TYPES = ["pending", "test", "command", "owner", "metric"];
const ID_ORDER = "TABCDEFGHMO";
const DEFAULT_FLAGS = { set: "all", only: null, strict: false, "ci-green": null, "with-base": false, json: false, "no-write": false };
const VALUE_FLAGS = ["set", "only", "ci-green"];
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/; // Number() would also take Infinity and 0x10
const TEST_ARGS = ["--test", "--experimental-test-module-mocks", "--test-reporter=tap"];
const UNIT_GLOBS = ["src/**/*.test.ts", "src/**/*.test.tsx"];
const TIMEOUT_MS = 30 * 60_000;
const CONNECT_ERROR = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|fetch failed|socket hang up/;
const HEADERS = ["ID", "Set", "Status", "Gate", "Detail"];
const BASE_GATES = [
  { id: "BASE-typecheck", title: "Typecheck", check: { type: "command", run: "npx tsc --noEmit" } },
  { id: "BASE-lint", title: "Lint", check: { type: "command", run: "npx eslint" } },
  { id: "BASE-unit", title: "Unit suite, sandbox-only failures excused by name", check: { type: "unit" } },
].map((gate) => ({ ...gate, kind: "base", set: "launch" }));
const SCORE_GROUPS = [
  ["Base gates", (row) => row.kind === "base"],
  ["Launch tasks", (row) => row.kind === "task" && row.set === "launch"],
  ["Launch metrics", (row) => row.kind === "metric" && row.set === "launch"],
  ["Owner rows", (row) => row.kind === "owner"],
  ["Pilot tasks", (row) => row.kind === "task" && row.set === "pilot"],
  ["Pilot metrics", (row) => row.kind === "metric" && row.set === "pilot"],
];

class ConfigError extends Error {}
const lastLine = (text) => text.trim().split("\n").at(-1).trim();
const isStringList = (value) => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string");

export function parseArgs(argv) {
  const flags = { ...DEFAULT_FLAGS };
  for (const arg of argv) {
    const [, name, value] = arg.match(/^--([a-z-]+)(?:=(.+))?$/) ?? [];
    if (!name || !Object.hasOwn(DEFAULT_FLAGS, name)) throw new ConfigError(`unknown flag: ${arg}`);
    const takesValue = VALUE_FLAGS.includes(name);
    if (takesValue !== (value !== undefined)) throw new ConfigError(`--${name} ${takesValue ? "needs a value" : "takes no value"}`);
    flags[name] = takesValue ? value : true;
  }
  if (!["launch", "pilot", "all"].includes(flags.set)) throw new ConfigError("--set must be launch, pilot or all");
  return { ...flags, only: flags.only ? flags.only.split(",") : null };
}

function validateGate(gate, file) {
  const need = (ok, why) => {
    if (!ok) throw new ConfigError(`${file}: ${why}`);
  };
  need(gate !== null && typeof gate === "object", "a gate must be a JSON object");
  const check = gate.check ?? {};
  for (const field of ["id", "title", "doneWhen"]) need(typeof gate[field] === "string" && gate[field], `"${field}" must be text`);
  need(KINDS.includes(gate.kind) && gate.kind !== "base", `"kind" must be task, metric or owner`);
  need(SETS.includes(gate.set), `"set" must be one of ${SETS.join(", ")}`);
  need(CHECK_TYPES.includes(check.type), `"check.type" must be one of ${CHECK_TYPES.join(", ")}`);
  need(check.needs === undefined || ["ci", "network"].includes(check.needs), `"check.needs" must be ci or network`);
  need(check.needs !== "ci" || check.type === "test", `"needs": "ci" is only valid on a test check`);
  if (check.type === "test") need(isStringList(check.files), `a test check needs "files"`);
  if (check.type === "command") need(typeof check.run === "string", `a command check needs "run"`);
  if (check.type === "owner") need(typeof check.doc === "string" && isStringList(check.rows), `an owner check needs "doc" and "rows"`);
  if (check.type !== "metric") return;
  need(check.run === null || typeof check.run === "string", `a metric needs "run": a command or null`);
  need(typeof check.target === "number" && typeof check.unit === "string", `a metric needs a numeric "target" and a "unit"`);
  need(["atMost", "atLeast"].includes(check.direction), `a metric "direction" must be atMost or atLeast`);
}

function planOrder(gate) {
  return [KINDS.indexOf(gate.kind), ID_ORDER.indexOf(gate.id[0]), Number(gate.id.match(/\d+/)?.[0] ?? 0)];
}

/** Every gate under config/readiness/gates/, validated, in plan order. */
export function loadGates(root) {
  const dir = join(root, GATES_DIR);
  if (!existsSync(dir)) throw new ConfigError(`no gate directory at ${GATES_DIR}`);
  const fileOf = new Map();
  const gates = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    let gate;
    try {
      gate = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (error) {
      throw new ConfigError(`${file}: not valid JSON (${error.message})`);
    }
    validateGate(gate, file);
    if (fileOf.has(gate.id)) throw new ConfigError(`duplicate id ${gate.id} in ${fileOf.get(gate.id)} and ${file}`);
    fileOf.set(gate.id, file);
    gates.push(gate);
  }
  for (const [id, file] of fileOf) {
    if (file !== `${id}.json`) throw new ConfigError(`gate id ${id} has no file ${id}.json (it is in ${file})`);
  }
  const order = new Map(gates.map((gate) => [gate, planOrder(gate)]));
  return gates.sort((a, b) => order.get(a).map((part, i) => part - order.get(b)[i]).find((diff) => diff !== 0) ?? 0);
}

/** Run one process. `shell` is used only for the commands committed in the gate files. */
function runProcess(command, args, { root, shell = false, network = false }) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // inherited from `node --test`, it makes a nested run skip every file and exit 0
  if (network) env.NODE_USE_ENV_PROXY = "1"; // Node then honors HTTPS_PROXY where one is set
  const run = spawnSync(command, args, { cwd: root, env, shell, encoding: "utf8", maxBuffer: 2 ** 29, timeout: TIMEOUT_MS });
  return { code: run.status ?? 1, stdout: run.stdout ?? "", stderr: (run.stderr ?? "") + (run.error?.message ?? "") };
}

function tsxLoader() {
  try {
    return import.meta.resolve("tsx"); // absolute, so a check may run from any root
  } catch {
    return "tsx"; // not installed: the child fails with Node's own message
  }
}

/** node --test reads file arguments as globs. Escape "[" so a route folder such as [id] is matched as written. */
const literalPath = (file) => file.replaceAll("[", "[[]");

function runTests(root, extraArgs) {
  const run = runProcess(process.execPath, ["--import", tsxLoader(), ...TEST_ARGS, ...extraArgs], { root });
  return { ...run, tap: parseTap(run.stdout, root) };
}

function unconnected(check, run) {
  const offline = check.needs === "network" && CONNECT_ERROR.test(run.stderr + run.stdout);
  return offline ? verdict("unmeasured", "could not connect") : null;
}

const RUNNERS = {
  pending: () => verdict("pending", "no check yet"),
  test(check, root) {
    const missing = check.files.filter((file) => !existsSync(join(root, file)));
    if (missing.length > 0) return verdict("fail", `missing test file: ${missing.join(", ")}`);
    const pattern = check.namePattern ? [`--test-name-pattern=${check.namePattern}`] : [];
    const { code, tap } = runTests(root, [...pattern, ...check.files.map(literalPath)]);
    const failed = tap.failed.map((failure) => failure.name).slice(0, 5).join("; ");
    if (code !== 0) return verdict("fail", failed ? `failed: ${failed}` : `exit ${code} with no failing test in the output`);
    return tap.passed.length === 0 ? verdict("fail", "no test matched") : verdict("pass", `${plural(tap.passed.length, "test")} passed`);
  },
  command(check, root) {
    const run = runProcess(check.run, [], { root, shell: true, network: check.needs === "network" });
    if (run.code === 0) return verdict("pass", "exit 0");
    return unconnected(check, run) ?? verdict("fail", `exit ${run.code}: ${lastLine(run.stderr || run.stdout)}`);
  },
  metric(check, root) {
    const goal = `target ${check.direction === "atMost" ? "at most" : "at least"} ${check.target}, baseline ${check.baseline ?? "not measured"}`;
    if (check.run === null) return verdict("unmeasured", `no measuring command yet (${goal})`);
    const run = runProcess(check.run, [], { root, shell: true, network: check.needs === "network" });
    const printed = lastLine(run.stdout);
    if (run.code !== 0 || !PLAIN_NUMBER.test(printed)) {
      return unconnected(check, run) ?? verdict("fail", `exit ${run.code}, no number on the last line`);
    }
    const met = check.direction === "atMost" ? Number(printed) <= check.target : Number(printed) >= check.target;
    return verdict(met ? "pass" : "fail", `${printed} ${check.unit} (${goal})`);
  },
  owner(check, root) {
    if (!existsSync(join(root, check.doc))) return verdict("fail", `checklist not found: ${check.doc}`);
    const checklist = parseChecklist(readFileSync(join(root, check.doc), "utf8"));
    const missing = check.rows.filter((row) => !checklist.has(row));
    if (missing.length > 0) return verdict("fail", `row not found: ${missing.join("; ")}`);
    const results = check.rows.flatMap((row) => checklist.get(row));
    const tally = `${results.filter((value) => value === "verified").length} of ${plural(results.length, "row")} verified`;
    if (results.includes("failed")) return verdict("fail", `a row reads failed (${tally})`);
    return verdict(results.every((value) => value === "verified") ? "pass" : "owner-open", tally);
  },
  unit(check, root) {
    const known = excusable(readKnownFailures(root), process.env);
    const { code, tap } = runTests(root, ["--test-concurrency=4", ...UNIT_GLOBS]);
    return judgeUnitSuite(tap, code, known);
  },
};

function readKnownFailures(root) {
  let failures;
  try {
    ({ failures } = JSON.parse(readFileSync(join(root, KNOWN_FAILURES), "utf8")));
  } catch (error) {
    throw new ConfigError(`${KNOWN_FAILURES}: ${error.message}`);
  }
  if (!Array.isArray(failures)) throw new ConfigError(`${KNOWN_FAILURES}: "failures" must be a list`);
  return failures;
}

function evaluate(gate, root, flags) {
  const { check } = gate;
  if (check.type === "pending" || check.needs !== "ci") return RUNNERS[check.type](check, root);
  if (!flags["ci-green"]) return verdict("needs-ci", "runs only in CI");
  const missing = check.files.filter((file) => !existsSync(join(root, file)));
  if (missing.length > 0) return verdict("fail", `--ci-green, but missing test file: ${missing.join(", ")}`);
  const detail = `not run here: green in CI run ${flags["ci-green"]} (${plural(check.files.length, "test file")} found)`;
  return { ...verdict("pass", detail), via: "ci" };
}

function selectGates(root, flags) {
  const all = [...(flags["with-base"] ? BASE_GATES : []), ...loadGates(root)];
  const unknown = (flags.only ?? []).filter((id) => !all.some((gate) => gate.id === id));
  if (unknown.length > 0) throw new ConfigError(`gate id with no file in ${GATES_DIR}: ${unknown.join(", ")}`);
  return all
    .filter((gate) => !flags.only || flags.only.includes(gate.id))
    .filter((gate) => gate.kind === "base" || flags.set === "all" || gate.set === flags.set);
}

function scoreLines(rows) {
  return SCORE_GROUPS.map(([label, belongs]) => {
    const group = rows.filter(belongs);
    return { label, passed: group.filter((row) => row.status === "pass").length, total: group.length };
  }).filter((score) => score.label !== "Base gates" || score.total > 0);
}

function textTable(rows) {
  const cells = [HEADERS, ...rows];
  const widths = HEADERS.map((_, column) => Math.max(...cells.map((row) => row[column].length)));
  return cells.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd()).join("\n");
}

function markdownTable(rows) {
  const line = (cells) => `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
  return [line(HEADERS), line(HEADERS.map(() => "---")), ...rows.map(line)].join("\n");
}

/** The same report as plain text for stdout or as Markdown for latest.md. */
function render(report, markdown) {
  const heading = (text, level) => (markdown ? `${"#".repeat(level)} ${text}` : text);
  const block = (title, kindMatches) => {
    const rows = report.gates.filter((row) => kindMatches(row.kind)).map((row) => [row.id, row.set, row.status, row.title, row.detail]);
    return rows.length === 0 ? [] : [heading(title, 2), (markdown ? markdownTable : textTable)(rows)];
  };
  const viaCi = report.gates.filter((row) => row.via === "ci").map((row) => row.id);
  const note = `Note: --ci-green was used. ${plural(viaCi.length, "gate")} count as pass on CI run ${report.ciGreen}, without running here: ${viaCi.join(", ") || "none"}.`;
  return [
    heading("Readiness scorecard", 1),
    `Generated ${report.generatedAt} at commit ${report.commit}. Flags: ${report.flags}.`,
    ...block("Gates", (kind) => kind !== "owner"),
    ...block("Owner track: only Britt can close these rows", (kind) => kind === "owner"),
    heading("Scores", 2),
    report.scores.map((score) => `${score.label}: ${score.passed}/${score.total}`).join(markdown ? "\n\n" : "\n"),
    ...(report.ciGreen ? [note] : []),
  ].join("\n\n");
}

/** The short commit, with "-dirty" when the tree has uncommitted changes. */
function commitLabel(root) {
  const head = runProcess("git", ["rev-parse", "--short", "HEAD"], { root });
  if (head.code !== 0 || !head.stdout.trim()) return "unknown";
  const changed = runProcess("git", ["status", "--porcelain"], { root }).stdout.trim() !== "";
  return `${head.stdout.trim()}${changed ? "-dirty" : ""}`;
}

export function main(argv, root) {
  const flags = parseArgs(argv);
  const rows = selectGates(root, flags).map((gate) => {
    const { id, kind, set, title } = gate;
    return { id, kind, set, title, ...evaluate(gate, root, flags) };
  });
  const report = {
    generatedAt: new Date().toISOString(),
    commit: commitLabel(root),
    flags: argv.join(" ") || "none",
    ciGreen: flags["ci-green"],
    scores: scoreLines(rows),
    gates: rows,
  };
  const subset = flags.only !== null || flags.set !== "all";
  if (subset && !flags["no-write"]) console.error(`readiness: reports not written, because --only and --set run a subset and ${REPORT_DIR}/latest.* holds every gate`);
  if (!subset && !flags["no-write"]) {
    mkdirSync(join(root, REPORT_DIR), { recursive: true });
    writeFileSync(join(root, REPORT_DIR, "latest.md"), `${render(report, true)}\n`);
    writeFileSync(join(root, REPORT_DIR, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(flags.json ? JSON.stringify(report, null, 2) : render(report, false));
  return flags.strict && rows.some((row) => row.set === "launch" && row.status !== "pass") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const root = resolve(process.env.READINESS_ROOT ?? join(fileURLToPath(import.meta.url), "..", "..", ".."));
  try {
    process.exitCode = main(process.argv.slice(2), root);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`readiness: ${error.message}`);
    process.exitCode = 2;
  }
}
