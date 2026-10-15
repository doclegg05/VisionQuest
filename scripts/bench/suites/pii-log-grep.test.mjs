import { test } from "node:test";
import assert from "node:assert/strict";
import { eslintMetric, tallyPiiMessages } from "./pii-log-grep.mjs";

// `n` is the sample size behind a value (config/benchmarks/result.schema.json).
// For the eslint metric that is the files eslint checked, not the violations
// it found: a clean tree is many files with zero violations, and reporting it
// as zero samples would read as "checked nothing".

const PII_MESSAGE = "No student identifier in logger payloads.";

function eslintReport(files) {
  return JSON.stringify(
    files.map(({ filePath, messages = [] }) => ({ filePath, messages })),
  );
}

test("tallyPiiMessages counts every file eslint checked, clean ones included", () => {
  const tally = tallyPiiMessages(
    eslintReport([{ filePath: "/repo/a.ts" }, { filePath: "/repo/b.ts" }, { filePath: "/repo/c.ts" }]),
  );
  assert.equal(tally.filesLinted, 3);
  assert.deepEqual(tally.violations, []);
});

test("tallyPiiMessages keeps only the PII selector's messages", () => {
  const tally = tallyPiiMessages(
    eslintReport([
      {
        filePath: "/repo/a.ts",
        messages: [
          { ruleId: "no-restricted-syntax", message: PII_MESSAGE, line: 4 },
          { ruleId: "no-restricted-syntax", message: "Something else entirely.", line: 9 },
          { ruleId: "no-unused-vars", message: PII_MESSAGE, line: 12 },
        ],
      },
      { filePath: "/repo/b.ts" },
    ]),
  );
  assert.equal(tally.filesLinted, 2);
  assert.deepEqual(tally.violations, [{ file: "/repo/a.ts", line: 4, message: PII_MESSAGE }]);
});

test("eslintMetric reports files linted as its sample size", () => {
  const metric = eslintMetric({ violations: [], filesLinted: 1719 });
  assert.equal(metric.id, "pii_eslint_violations");
  assert.equal(metric.value, 0);
  assert.equal(metric.n, 1719);
});

test("eslintMetric reads an eslint tooling failure as zero samples, never as a clean tree", () => {
  // The runner turns a floored gate metric over zero samples into an error.
  const metric = eslintMetric({ toolingError: "eslint did not finish within 300000ms (killed by SIGKILL)" });
  assert.equal(metric.n, 0);
  assert.match(metric.details.toolingError, /did not finish/);
});
