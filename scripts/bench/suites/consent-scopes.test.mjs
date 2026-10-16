import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHILD_ARGS, scoreTap } from "./consent-scopes.mjs";

// Real reporter output, not hand-typed TAP: each case runs a small node:test
// file the way the scorer runs consent-scopes.bench.test.ts, so a change in
// Node's reporter shows up here first. NODE_TEST_CONTEXT is dropped because
// this file itself runs under `node --test`, and a nested run that inherits it
// speaks the runner's serialized protocol instead of printing a report.
function reportFrom(source, reporterArgs) {
  const dir = mkdtempSync(join(tmpdir(), "consent-scopes-tap-"));
  try {
    const file = join(dir, "case.test.mjs");
    writeFileSync(file, source);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const out = spawnSync(process.execPath, ["--test", ...reporterArgs, file], { encoding: "utf8", env });
    return { text: out.stdout + out.stderr, status: out.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tapFrom = (source) => reportFrom(source, ["--test-reporter=tap"]);
const score = ({ text, status }) => scoreTap(text, status);

const SUITE = (body) => `
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
describe("consent scopes (integration)", () => {
${body}
});
`;

const THREE_PASSING = SUITE(`
  it("sendConnection refuses", () => {});
  it("sendPolicySms refuses", () => {});
  it("selectBatchStudents excludes", () => {});
`);

test("the child is asked for TAP, because Node 24's default reporter is spec even through a pipe", () => {
  assert.ok(CHILD_ARGS.includes("--test-reporter=tap"), CHILD_ARGS.join(" "));
});

test("three refusals score 0 writes over 3 samples, not over the one suite line", () => {
  const metric = score(tapFrom(THREE_PASSING));
  assert.equal(metric.value, 0);
  assert.equal(metric.n, 3);
});

test("a write that got through counts as 1 over 3, and names the test", () => {
  const metric = score(
    tapFrom(
      SUITE(`
  it("sendConnection refuses", () => {});
  it("sendPolicySms refuses", () => { assert.equal("sent", "refused"); });
  it("selectBatchStudents excludes", () => {});
`)
    )
  );
  assert.equal(metric.value, 1);
  assert.equal(metric.n, 3);
  assert.ok(
    metric.details.failures.some((name) => name.includes("sendPolicySms refuses")),
    JSON.stringify(metric.details.failures)
  );
});

test("a broken fixture is an error, not a pass: cancelled tests exercised nothing", () => {
  const run = tapFrom(
    SUITE(`
  before(() => { throw new Error("fixture setup broke"); });
  it("sendConnection refuses", () => {});
  it("sendPolicySms refuses", () => {});
  it("selectBatchStudents excludes", () => {});
`)
  );
  assert.throws(() => score(run), /cancelled 3/);
});

test("a failing cleanup hook is an error, even though every test passed", () => {
  // node:test reports the hook as a failed suite but leaves `# fail 0`.
  const run = tapFrom(
    SUITE(`
  after(() => { throw new Error("cleanup broke"); });
  it("sendConnection refuses", () => {});
  it("sendPolicySms refuses", () => {});
  it("selectBatchStudents excludes", () => {});
`).replace("import { before,", "import { after, before,")
  );
  assert.throws(() => score(run), /exited 1/);
});

test("a skipped write path is an error: the gate covers all three", () => {
  const run = tapFrom(
    SUITE(`
  it("sendConnection refuses", () => {});
  it.skip("sendPolicySms refuses", () => {});
  it("selectBatchStudents excludes", () => {});
`)
  );
  assert.throws(() => score(run), /expected 3/);
});

test("a run that stopped after one test is an error", () => {
  const run = tapFrom(
    SUITE(`
  it("sendConnection refuses", () => { process.exit(0); });
  it("sendPolicySms refuses", () => {});
  it("selectBatchStudents excludes", () => {});
`)
  );
  assert.throws(() => score(run), /expected 3/);
});

test("a test file that cannot load is an error, not a write that got through", () => {
  const run = tapFrom(`import "./no-such-module.mjs";\n`);
  assert.throws(() => score(run), /expected 3/);
});

test("the test file skipping itself after the scorer saw the opt-in is an error, not a pass", () => {
  const tap = tapFrom(`
import { describe, it } from "node:test";
describe("consent scopes (integration) — SKIPPED", () => {
  it("requires RLS_TEST_ENABLED=true and DATABASE_URL pointing at a test DB", () => {});
});
`);
  assert.throws(() => score(tap), /expected 3/);
});

test("spec-reporter output is not a measurement", () => {
  // The bug this file was written for: the old parser counted only lines
  // starting `ok N`, which spec output never has, so every run read 0 over 0.
  const spec = reportFrom(THREE_PASSING, ["--test-reporter=spec"]);
  assert.throws(() => score(spec), /no TAP summary/);
});

test("a child that crashed before reporting is an error", () => {
  assert.throws(() => scoreTap("Error: Cannot find module '@/lib/db'\n", 1), /no TAP summary/);
});

test("app output echoed as a TAP comment cannot override the closing summary", () => {
  // node:test re-emits a test process's stray stdout as `# <line>` comments.
  const run = tapFrom(THREE_PASSING);
  const metric = scoreTap(`# pass 99\n# fail 0\n${run.text}`, run.status);
  assert.equal(metric.n, 3);
});
