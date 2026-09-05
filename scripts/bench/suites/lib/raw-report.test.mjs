import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readRunReport } from "./raw-report.mjs";

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
    fixture: {
      reportPath,
      maxReportAgeHours: options.maxReportAgeHours,
      howToRun: ["npm run bench"],
    },
  };
}

describe("readRunReport", () => {
  it("returns the parsed report and its age", () => {
    const result = readRunReport(ctxWith({ write: { completed: 1 }, ageHours: 0 }));
    assert.equal(result.report.completed, 1);
    assert.ok(result.ageHours < 1);
  });

  it("skips with the how-to-run lines when the report is absent", () => {
    const result = readRunReport(ctxWith({}));
    assert.match(result.skipped, /no run report/u);
    assert.match(result.skipped, /npm run bench/u);
    assert.equal(result.report, undefined);
  });

  it("treats a stale report as absent — a green result from last week is not proof", () => {
    const result = readRunReport(
      ctxWith({ write: { completed: 1 }, ageHours: 48, maxReportAgeHours: 24 }),
    );
    assert.match(result.skipped, /48\.0 h old \(limit 24 h\)/u);
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
