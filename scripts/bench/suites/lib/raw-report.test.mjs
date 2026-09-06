import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  collectorRequirementsMet,
  readRunReport,
  readRunReportOrExplain,
  unavailableMetrics,
} from "./raw-report.mjs";

const DECLARED = {
  metrics: [{ id: "completed" }, { id: "student_taps" }],
};

function ctxWith(options) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "bench-raw-report-"));
  const reportPath = "run.json";
  if (options.write !== undefined) {
    const full = path.join(repoRoot, reportPath);
    writeFileSync(full, JSON.stringify(options.write));
    if (options.ageHours !== undefined) {
      const when = new Date(Date.now() - options.ageHours * 60 * 60 * 1000);
      utimesSync(full, when, when);
    }
  }
  return {
    repoRoot,
    config: options.config ?? DECLARED,
    env: options.env ?? {},
    fixture: {
      reportPath,
      maxReportAgeHours: options.maxReportAgeHours,
      howToRun: ["npx playwright test e2e/bench-example.spec.ts"],
    },
  };
}

/** The environment the CI collection step presents. */
const COLLECTOR_ENV = {
  playwright: "1",
  baseUrl: "http://localhost:3000",
  databaseUrl: "postgresql://localhost:5432/x",
};

describe("readRunReport", () => {
  it("returns the parsed report and its age", () => {
    const result = readRunReport(ctxWith({ write: { completed: 1 }, ageHours: 0 }));
    assert.equal(result.report.completed, 1);
    assert.ok(result.ageHours < 1);
  });

  it("reports the absence with the how-to-run lines, never a bare skip", () => {
    const result = readRunReport(ctxWith({}));
    assert.match(result.unavailable, /no run report/u);
    assert.match(result.unavailable, /bench-example\.spec\.ts/u);
    assert.equal(result.report, undefined);
    // The field a scorer used to return straight through to the runner.
    assert.equal(result.skipped, undefined);
  });

  it("treats a stale report as absent — a green result from last week is not proof", () => {
    const result = readRunReport(
      ctxWith({ write: { completed: 1 }, ageHours: 48, maxReportAgeHours: 24 }),
    );
    assert.match(result.unavailable, /48\.0 h old \(limit 24 h\)/u);
    assert.equal(result.report, undefined);
  });

  it("scores a report inside the age limit", () => {
    const result = readRunReport(
      ctxWith({ write: { completed: 1 }, ageHours: 2, maxReportAgeHours: 24 }),
    );
    assert.equal(result.report.completed, 1);
  });

  it("has no age limit when the fixture declares none", () => {
    const result = readRunReport(ctxWith({ write: { completed: 1 }, ageHours: 5_000 }));
    assert.equal(result.report.completed, 1);
  });
});

describe("collectorRequirementsMet", () => {
  it("is true only with a browser, a server AND a database", () => {
    assert.equal(collectorRequirementsMet({ env: COLLECTOR_ENV }), true);
    for (const missing of ["playwright", "baseUrl", "databaseUrl"]) {
      const env = { ...COLLECTOR_ENV, [missing]: null };
      assert.equal(collectorRequirementsMet({ env }), false, `${missing} should be required`);
    }
  });

  it("is false, not a crash, with no env at all", () => {
    assert.equal(collectorRequirementsMet({}), false);
    assert.equal(collectorRequirementsMet(undefined), false);
  });
});

describe("unavailableMetrics", () => {
  it("names every metric the CONFIG declares, so the runner finds no gap", () => {
    const result = unavailableMetrics(ctxWith({}), "because");
    assert.deepEqual(
      result.metrics.map((metric) => metric.id),
      ["completed", "student_taps"],
    );
    for (const metric of result.metrics) {
      assert.equal(metric.value, null);
      assert.deepEqual(metric.details, { skipped: true, reason: "because" });
    }
  });

  it("throws rather than invent a metric id when the ctx carries no config", () => {
    assert.throws(
      () => unavailableMetrics({ config: { metrics: [] } }, "because"),
      /declares no metrics/u,
    );
  });
});

describe("readRunReportOrExplain", () => {
  it("returns the report when there is one", () => {
    const result = readRunReportOrExplain(ctxWith({ write: { completed: 1 } }), "example");
    assert.equal(result.report.completed, 1);
    assert.equal(result.metrics, undefined);
  });

  it("returns null metrics when nothing could have collected the report", () => {
    const result = readRunReportOrExplain(ctxWith({}), "example");
    assert.equal(result.metrics.length, 2);
    assert.equal(result.metrics[0].value, null);
  });

  it("THROWS when the collector could have run and did not", () => {
    assert.throws(
      () => readRunReportOrExplain(ctxWith({ env: COLLECTOR_ENV }), "example"),
      (error) => {
        assert.match(error.message, /^example: browser\+server are available but no run report/u);
        return true;
      },
    );
  });
});
