import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { loadBenchmarkDashboard, type BenchmarkDashboardData } from "./dashboard";

/**
 * Fixture repos live under a temp path, never the real checkout: the loader
 * reads whatever `config/benchmarks/` and `reports/benchmarks/` hold, so a
 * test pointed at the repo would change its answer every time a suite lands.
 */
const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface FixtureOptions {
  configs?: Record<string, unknown>;
  latest?: Record<string, unknown> | null;
  baseline?: unknown;
}

function write(path: string, body: unknown): void {
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
}

function makeRepo(options: FixtureOptions): string {
  const root = mkdtempSync(join(tmpdir(), "bench-dashboard-"));
  roots.push(root);

  const configDir = join(root, "config", "benchmarks");
  mkdirSync(configDir, { recursive: true });
  for (const [name, body] of Object.entries(options.configs ?? {})) {
    write(join(configDir, `${name}.json`), body);
  }

  const reportDir = join(root, "reports", "benchmarks");
  mkdirSync(reportDir, { recursive: true });
  if (options.baseline !== undefined) {
    write(join(reportDir, "baseline.json"), options.baseline);
  }

  // `latest: null` means the directory itself is absent — the state of a
  // checkout where the nightly workflow has never committed a result.
  if (options.latest !== null) {
    const latestDir = join(reportDir, "latest");
    mkdirSync(latestDir, { recursive: true });
    for (const [name, body] of Object.entries(options.latest ?? {})) {
      write(join(latestDir, `${name}.json`), body);
    }
  }

  return root;
}

function gateConfig(overrides: Record<string, unknown> = {}) {
  return {
    suite: "crisis-en",
    title: "Crisis detector, English",
    area: "safety",
    tier: "gate",
    scorer: "scripts/bench/suites/crisis-en.mjs",
    metrics: [
      { id: "recall_must_detect", unit: "ratio", direction: "higher", floor: 0.98, tolerance: 0.01 },
    ],
    ...overrides,
  };
}

function gateResult(value: number, overrides: Record<string, unknown> = {}) {
  return {
    suite: "crisis-en",
    tier: "gate",
    startedAt: "2026-09-05T04:00:00.000Z",
    durationMs: 1200,
    commit: "abc1234",
    provider: null,
    model: null,
    host: { os: "linux", cpus: 4, memGb: 16, node: "v24.0.0" },
    metrics: [
      {
        id: "recall_must_detect",
        value,
        unit: "ratio",
        direction: "higher",
        floor: 0.98,
        tolerance: 0.01,
        n: 200,
        status: "pass",
      },
    ],
    status: "pass",
    ...overrides,
  };
}

function findSuite(data: BenchmarkDashboardData, name: string) {
  for (const area of data.areas) {
    const suite = area.suites.find((row) => row.suite === name);
    if (suite) return suite;
  }
  return undefined;
}

describe("loadBenchmarkDashboard", () => {
  it("reports every suite as not run when the latest directory is missing", () => {
    const root = makeRepo({ configs: { "crisis-en": gateConfig() }, latest: null });
    const data = loadBenchmarkDashboard({ repoRoot: root });

    const suite = findSuite(data, "crisis-en");
    assert.ok(suite);
    assert.equal(suite.state, "not-run");
    assert.equal(suite.hasResult, false);
    assert.equal(suite.problem, null);
    assert.equal(data.problems.length, 0);
    assert.equal(data.summary.gateNotRun, 1);
    assert.equal(data.summary.gateFailing, 0);
    assert.equal(data.lastRanAt, null);
    // The floor a suite promises is readable before it has ever run.
    assert.equal(suite.metrics[0].floor, 0.98);
    assert.equal(suite.metrics[0].value, null);
  });

  it("returns an empty dashboard rather than throwing when nothing exists", () => {
    const root = mkdtempSync(join(tmpdir(), "bench-dashboard-empty-"));
    roots.push(root);
    const data = loadBenchmarkDashboard({ repoRoot: root });
    assert.deepEqual(data.areas, []);
    assert.equal(data.summary.gateTotal, 0);
  });

  it("keeps suites without a result alongside suites with one", () => {
    const root = makeRepo({
      configs: {
        "crisis-en": gateConfig(),
        coverage: {
          suite: "coverage",
          title: "Test coverage",
          area: "meta",
          tier: "watch",
          scorer: "scripts/bench/suites/coverage.mjs",
          metrics: [{ id: "line_coverage", unit: "percent", direction: "higher", floor: 60 }],
        },
      },
      latest: { "crisis-en": gateResult(0.99) },
    });
    const data = loadBenchmarkDashboard({ repoRoot: root });

    assert.equal(findSuite(data, "crisis-en")?.hasResult, true);
    assert.equal(findSuite(data, "coverage")?.state, "not-run");
    assert.equal(data.summary.suitesWithResults, 1);
    assert.equal(data.lastRanAt, "2026-09-05T04:00:00.000Z");
    assert.equal(data.lastCommit, "abc1234");
  });

  it("carries the suite's notes through so the page can explain a number", () => {
    const root = makeRepo({
      configs: { "crisis-en": gateConfig({ notes: "Tier is watch, not gate, on purpose." }) },
      latest: {},
    });
    const suite = findSuite(loadBenchmarkDashboard({ repoRoot: root }), "crisis-en");
    assert.equal(suite?.notes, "Tier is watch, not gate, on purpose.");
  });

  it("groups suites by area, in codepoint order", () => {
    const root = makeRepo({
      configs: {
        "crisis-en": gateConfig(),
        coverage: {
          suite: "coverage",
          title: "Test coverage",
          area: "meta",
          tier: "watch",
          scorer: "s.mjs",
          metrics: [{ id: "line_coverage", unit: "percent", direction: "higher", floor: 60 }],
        },
      },
      latest: {},
    });
    const data = loadBenchmarkDashboard({ repoRoot: root });
    assert.deepEqual(
      data.areas.map((area) => area.area),
      ["meta", "safety"],
    );
  });

  it("reports a malformed result file as a row-level problem, not a throw", () => {
    const root = makeRepo({
      configs: { "crisis-en": gateConfig() },
      latest: { "crisis-en": "{ not json" },
    });
    const data = loadBenchmarkDashboard({ repoRoot: root });

    const suite = findSuite(data, "crisis-en");
    assert.ok(suite);
    assert.equal(suite.state, "not-run");
    assert.ok(suite.problem && suite.problem.length > 0);
    assert.equal(data.summary.gateNotRun, 1);
  });

  it("reports a malformed suite config as a problem and keeps the other suites", () => {
    const root = makeRepo({
      configs: { "crisis-en": gateConfig(), broken: "{{{" },
      latest: { "crisis-en": gateResult(0.99) },
    });
    const data = loadBenchmarkDashboard({ repoRoot: root });

    assert.equal(data.problems.length, 1);
    assert.match(data.problems[0], /broken\.json/);
    assert.ok(findSuite(data, "crisis-en"));
  });

  it("survives a malformed baseline file", () => {
    const root = makeRepo({
      configs: { "crisis-en": gateConfig() },
      latest: { "crisis-en": gateResult(0.99) },
      baseline: "not json at all",
    });
    const data = loadBenchmarkDashboard({ repoRoot: root });

    assert.ok(data.problems.some((problem) => /baseline/.test(problem)));
    assert.equal(findSuite(data, "crisis-en")?.metrics[0].baseline, null);
  });

  it("marks a metric with a null floor as tracked, never as a pass or a fail", () => {
    const root = makeRepo({
      configs: {
        "cost-per-student": {
          suite: "cost-per-student",
          title: "Cost per active student",
          area: "ops",
          tier: "nightly",
          scorer: "s.mjs",
          metrics: [
            {
              id: "usd_per_active_student_month",
              unit: "count",
              displayUnit: "usd",
              direction: "lower",
              floor: null,
              reason: "No budget ceiling is set yet.",
            },
          ],
        },
      },
      latest: {
        "cost-per-student": {
          suite: "cost-per-student",
          tier: "nightly",
          startedAt: "2026-09-05T04:00:00.000Z",
          durationMs: 10,
          commit: "abc1234",
          provider: null,
          model: null,
          host: { os: "linux", cpus: 4, memGb: 16, node: "v24.0.0" },
          metrics: [
            {
              id: "usd_per_active_student_month",
              value: 1.25,
              unit: "count",
              displayUnit: "usd",
              reason: "No budget ceiling is set yet.",
              direction: "lower",
              floor: null,
              status: "info",
            },
          ],
          status: "info",
        },
      },
    });
    const data = loadBenchmarkDashboard({ repoRoot: root });
    const metric = findSuite(data, "cost-per-student")?.metrics[0];

    assert.ok(metric);
    assert.equal(metric.status, "info");
    assert.equal(metric.tracked, true);
    assert.equal(metric.displayUnit, "usd");
    assert.equal(metric.reason, "No budget ceiling is set yet.");
    assert.equal(findSuite(data, "cost-per-student")?.state, "info");
  });

  it("counts a gate-tier floor breach as a failing gate suite", () => {
    const root = makeRepo({
      configs: { "crisis-en": gateConfig() },
      latest: { "crisis-en": gateResult(0.72) },
    });
    const data = loadBenchmarkDashboard({ repoRoot: root });

    const suite = findSuite(data, "crisis-en");
    assert.equal(suite?.metrics[0].status, "fail");
    assert.equal(suite?.state, "fail");
    assert.equal(data.summary.gateFailing, 1);
    assert.equal(data.summary.gatePassing, 0);
  });

  it("does not count a watch-tier failure as a gate failure", () => {
    const root = makeRepo({
      configs: { "crisis-en": gateConfig({ tier: "watch" }) },
      latest: { "crisis-en": gateResult(0.72, { tier: "watch" }) },
    });
    const data = loadBenchmarkDashboard({ repoRoot: root });

    const suite = findSuite(data, "crisis-en");
    assert.equal(suite?.state, "fail");
    assert.equal(suite?.blocking, false);
    assert.equal(data.summary.gateTotal, 0);
    assert.equal(data.summary.gateFailing, 0);
    assert.equal(data.summary.otherFailing, 1);
  });

  it("re-derives the status from the baseline on disk rather than trusting the result file", () => {
    // The result file says "pass"; the committed baseline says the value has
    // drifted past its tolerance, so the dashboard must read watch.
    const root = makeRepo({
      configs: { "crisis-en": gateConfig() },
      latest: { "crisis-en": gateResult(0.985) },
      baseline: {
        "crisis-en": {
          recall_must_detect: { value: 0.999, commit: "old1234", reason: "initial" },
        },
      },
    });
    const data = loadBenchmarkDashboard({ repoRoot: root });
    const metric = findSuite(data, "crisis-en")?.metrics[0];

    assert.equal(metric?.status, "watch");
    assert.equal(metric?.baseline, 0.999);
  });

  it("calls a higher-is-better rise better and a fall worse", () => {
    const root = makeRepo({
      configs: { "crisis-en": gateConfig() },
      latest: { "crisis-en": gateResult(0.995) },
      baseline: {
        "crisis-en": { recall_must_detect: { value: 0.99, commit: "old", reason: "initial" } },
      },
    });
    const metric = findSuite(loadBenchmarkDashboard({ repoRoot: root }), "crisis-en")?.metrics[0];
    assert.equal(metric?.movement, "better");
    assert.ok(metric?.delta !== null && metric !== undefined);
    assert.ok(Math.abs((metric?.delta ?? 0) - 0.005) < 1e-9);
  });

  it("calls a lower-is-better rise worse", () => {
    const root = makeRepo({
      configs: {
        latency: {
          suite: "latency",
          title: "Chat speed",
          area: "performance",
          tier: "nightly",
          scorer: "s.mjs",
          metrics: [{ id: "p95_ms", unit: "ms", direction: "lower", floor: 6000 }],
        },
      },
      latest: {
        latency: {
          suite: "latency",
          tier: "nightly",
          startedAt: "2026-09-05T04:00:00.000Z",
          durationMs: 10,
          commit: "abc1234",
          provider: null,
          model: null,
          host: { os: "linux", cpus: 4, memGb: 16, node: "v24.0.0" },
          metrics: [
            {
              id: "p95_ms",
              value: 4200,
              unit: "ms",
              direction: "lower",
              floor: 6000,
              status: "pass",
            },
          ],
          status: "pass",
        },
      },
      baseline: { latency: { p95_ms: { value: 3800, commit: "old", reason: "initial" } } },
    });
    const metric = findSuite(loadBenchmarkDashboard({ repoRoot: root }), "latency")?.metrics[0];
    assert.equal(metric?.movement, "worse");
    assert.equal(metric?.status, "pass");
  });

  it("says the movement is unknown when there is no baseline", () => {
    const root = makeRepo({
      configs: { "crisis-en": gateConfig() },
      latest: { "crisis-en": gateResult(0.99) },
    });
    const metric = findSuite(loadBenchmarkDashboard({ repoRoot: root }), "crisis-en")?.metrics[0];
    assert.equal(metric?.movement, "unknown");
    assert.equal(metric?.delta, null);
  });

  it("keeps a skipped suite out of the failing count and says why", () => {
    const root = makeRepo({
      configs: { "crisis-en": gateConfig({ requires: ["gemini"] }) },
      latest: {
        "crisis-en": gateResult(0.99, {
          status: "skipped",
          skipped: "GEMINI_API_KEY is not set",
          metrics: [],
        }),
      },
    });
    const data = loadBenchmarkDashboard({ repoRoot: root });
    const suite = findSuite(data, "crisis-en");

    assert.equal(suite?.state, "skipped");
    assert.equal(suite?.note, "GEMINI_API_KEY is not set");
    assert.equal(data.summary.gateFailing, 0);
    assert.equal(data.summary.gateNotRun, 1);
  });

  it("shows a config metric the run never reported", () => {
    const root = makeRepo({
      configs: {
        "crisis-en": gateConfig({
          metrics: [
            { id: "recall_must_detect", unit: "ratio", direction: "higher", floor: 0.98 },
            { id: "fp_rate_neutral", unit: "ratio", direction: "lower", floor: 0 },
          ],
        }),
      },
      latest: { "crisis-en": gateResult(0.99) },
    });
    const suite = findSuite(loadBenchmarkDashboard({ repoRoot: root }), "crisis-en");
    assert.equal(suite?.metrics.length, 2);
    assert.equal(suite?.metrics[1].value, null);
    assert.equal(suite?.metrics[1].status, "skipped");
  });

  it("returns data that survives a JSON round trip", () => {
    const root = makeRepo({
      configs: { "crisis-en": gateConfig() },
      latest: { "crisis-en": gateResult(0.99) },
    });
    const data = loadBenchmarkDashboard({ repoRoot: root });
    assert.deepEqual(JSON.parse(JSON.stringify(data)), data);
  });
});
