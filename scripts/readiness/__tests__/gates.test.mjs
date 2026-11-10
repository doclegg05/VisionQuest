// Tests that tie the committed gate files to the deployment readiness plan,
// and tests for the seed script that creates a gate file per plan task.
//
// These load and validate the real config. They never run a gate's check.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const SEED = join(HERE, "..", "seed-gates.mjs");
const PLAN = "docs/plans/2026-11-10-deployment-readiness.md";
const CHECKLIST = "docs/audits/2026-11-09-ops-evidence-checklist.md";
const scorecard = () => import("../scorecard.mjs");
const seed = () => import("../seed-gates.mjs");

/** Plan targets. A gate may tighten its target and may never loosen it. */
const METRICS = {
  M1: { target: 85, set: "launch" }, // estimated round trips; see the plan's Metrics section
  M2: { target: 8, set: "launch" },
  M3: { target: 12, set: "pilot" },
  M4: { target: 235, set: "launch" },
  M5: { target: 10, set: "launch" },
  M6: { target: 60, set: "pilot" },
  M7: { target: 60, set: "launch" },
  M8: { target: 1000, set: "pilot" },
};

async function realGates(kind) {
  const { loadGates } = await scorecard();
  return loadGates(ROOT).filter((gate) => gate.kind === kind);
}

// --- the committed gate files ---

test("the plan's task tables parse to 36 launch, 33 pilot and 1 hold task", async () => {
  const { readPlanTasks } = await seed();
  const counts = { launch: 0, pilot: 0, hold: 0 };
  for (const task of readPlanTasks(readFileSync(join(ROOT, PLAN), "utf8"))) counts[task.set] += 1;
  assert.deepEqual(counts, { launch: 36, pilot: 33, hold: 1 });
});

test("every task in the plan has a gate file with the plan's set, and no gate lacks a task", async () => {
  const { readPlanTasks } = await seed();
  const planned = readPlanTasks(readFileSync(join(ROOT, PLAN), "utf8")).map((task) => [task.id, task.set]);
  const committed = (await realGates("task")).map((gate) => [gate.id, gate.set]);
  assert.deepEqual(Object.fromEntries(committed), Object.fromEntries(planned));
});

test("the eight metric gates keep the plan's sets and never loosen a target", async () => {
  const gates = await realGates("metric");
  assert.deepEqual(gates.map((gate) => gate.id), Object.keys(METRICS));
  for (const gate of gates) {
    assert.equal(gate.set, METRICS[gate.id].set, `${gate.id} set`);
    assert.equal(gate.check.direction, "atMost", `${gate.id} direction`);
    assert.ok(gate.check.target <= METRICS[gate.id].target, `${gate.id} target ${gate.check.target} is looser than the plan`);
  }
});

test("the owner gates are O-1 to O-12", async () => {
  const ids = (await realGates("owner")).map((gate) => gate.id);
  assert.deepEqual(ids, Array.from({ length: 12 }, (_, index) => `O-${index + 1}`));
});

test("every owner check, task E0 included, names rows that the ops evidence checklist has", async () => {
  const { parseChecklist } = await import("../parse.mjs");
  const { loadGates } = await scorecard();
  const rows = parseChecklist(readFileSync(join(ROOT, CHECKLIST), "utf8"));
  const ownerChecked = loadGates(ROOT).filter((gate) => gate.check.type === "owner");
  assert.equal(ownerChecked.length, 13);
  for (const gate of ownerChecked) {
    assert.equal(gate.check.doc, CHECKLIST, `${gate.id} doc`);
    for (const row of gate.check.rows) assert.ok(rows.has(row), `${gate.id} names a row the checklist lacks: ${row}`);
  }
});

test("Summit 1 needs owner rows O-1 to O-8, O-10 and O-12", async () => {
  const launch = (await realGates("owner")).filter((gate) => gate.set === "launch").map((gate) => gate.id);
  assert.deepEqual(launch, ["O-1", "O-2", "O-3", "O-4", "O-5", "O-6", "O-7", "O-8", "O-10", "O-12"]);
});

test("the sandbox-only failures are the two tsx-spawning tests, each with a reason, and both still exist", () => {
  const { failures } = JSON.parse(readFileSync(join(ROOT, "config/readiness/sandbox-known-failures.json"), "utf8"));
  assert.deepEqual(failures.map((entry) => entry.file).sort(), [
    "src/lib/spokes/forms-delivery.test.ts",
    "src/lib/zod-csp.test.ts",
  ]);
  for (const entry of failures) {
    assert.ok(entry.reason.length > 0, `${entry.file} has a reason`);
    assert.ok(readFileSync(join(ROOT, entry.file), "utf8").includes(entry.name), `${entry.file} still has "${entry.name}"`);
  }
});

test("no gate file carries an en dash or an em dash", () => {
  const dir = join(ROOT, "config", "readiness", "gates");
  for (const file of readdirSync(dir)) {
    assert.doesNotMatch(readFileSync(join(dir, file), "utf8"), /[\u2012-\u2015]/, file);
  }
});

// --- the seed script ---

const PLAN_FIXTURE = `# Plan

### Stream 0

| ID | Set | Task | Done when | Size | Extra review |
| --- | --- | --- | --- | --- | --- |
| T1 | Launch | Readiness scorecard. It lists every gate. | The script prints one row per gate. | M | none |

### Stream C

| ID | Set | Task | Evidence | Src | Done when | Size | After | Extra review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C4 | Pilot, needs R8 | Teacher home leads with the queue. Queue first. | \`a.tsx:51\` | pass | Tests cover order and nav. | M | H3 | ux |
| F7 | Hold | A cheaper RLS wrapper. Not yet. | \`db.ts:204\` | seen | Not scheduled. | L | F5 | sec-spec, db |
| H8 | Launch | Incident basics page at \`docs/runbooks/incident-basics.md\`: who is told. An agent drafts it. | \`DEPLOY.md:289\` | pass | Britt's approval is recorded. | S | H3 | none |

## Metrics

| ID | Metric | Baseline | Target | Set |
| --- | --- | --- | --- | --- |
| M1 | App queries | about 39 | 20 or fewer | Launch |
`;

function seedRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "readiness-seed-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, dirname(PLAN)), { recursive: true });
  writeFileSync(join(root, PLAN), PLAN_FIXTURE);
  return root;
}

function runSeed(root) {
  return spawnSync(process.execPath, [SEED], { encoding: "utf8", env: { ...process.env, READINESS_ROOT: root } });
}

function readGate(root, id) {
  return JSON.parse(readFileSync(join(root, "config", "readiness", "gates", `${id}.json`), "utf8"));
}

test("readPlanTasks reads id, set, title and done-when from each task table and skips other tables", async () => {
  const { readPlanTasks } = await seed();
  assert.deepEqual(readPlanTasks(PLAN_FIXTURE), [
    { id: "T1", set: "launch", title: "Readiness scorecard", doneWhen: "The script prints one row per gate." },
    { id: "C4", set: "pilot", title: "Teacher home leads with the queue", doneWhen: "Tests cover order and nav." },
    { id: "F7", set: "hold", title: "A cheaper RLS wrapper", doneWhen: "Not scheduled." },
    {
      id: "H8",
      set: "launch",
      title: "Incident basics page at `docs/runbooks/incident-basics.md`",
      doneWhen: "Britt's approval is recorded.",
    },
  ]);
});

test("the seed writes a pending task gate for each plan task that has no file", (t) => {
  const root = seedRoot(t);
  const result = runSeed(root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readGate(root, "C4"), {
    id: "C4",
    kind: "task",
    set: "pilot",
    title: "Teacher home leads with the queue",
    doneWhen: "Tests cover order and nav.",
    check: { type: "pending" },
  });
  assert.match(result.stdout, /created 4, kept 0/);
});

test("the seed never overwrites a gate file that exists", (t) => {
  const root = seedRoot(t);
  const edited = { id: "T1", kind: "task", set: "launch", title: "Edited", doneWhen: "x", check: { type: "test", files: ["a.test.mjs"] } };
  mkdirSync(join(root, "config", "readiness", "gates"), { recursive: true });
  writeFileSync(join(root, "config", "readiness", "gates", "T1.json"), JSON.stringify(edited));
  const result = runSeed(root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readGate(root, "T1"), edited);
  assert.match(result.stdout, /created 3, kept 1/);
});
