import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLcov, normalizeLcovPath } from "./lcov.mjs";

const SAMPLE = `TN:
SF:../../src/lib/foo.ts
FN:1,foo
FNDA:1,foo
FNF:1
FNH:1
DA:1,1
DA:2,0
DA:3,1
LH:2
LF:3
end_of_record
SF:../../src/lib/bar.ts
DA:1,0
DA:2,0
LH:0
LF:2
end_of_record
`;

test("parseLcov: extracts per-file LF/LH and per-line hits", () => {
  const records = parseLcov(SAMPLE);
  assert.equal(records.length, 2);
  assert.equal(records[0].file, "../../src/lib/foo.ts");
  assert.equal(records[0].linesFound, 3);
  assert.equal(records[0].linesHit, 2);
  assert.equal(records[0].lines.get(2), 0);
  assert.equal(records[1].linesHit, 0);
});

test("parseLcov: empty input returns no records", () => {
  assert.deepEqual(parseLcov(""), []);
});

test("parseLcov: a record with no end_of_record still captures LF/LH parsed so far", () => {
  const records = parseLcov("SF:src/x.ts\nDA:1,1\nLF:1\nLH:1\n");
  assert.equal(records.length, 1);
  assert.equal(records[0].linesHit, 1);
});

test("normalizeLcovPath: strips reporter-relative prefix down to the src/ anchor", () => {
  assert.equal(normalizeLcovPath("../../src/lib/foo.ts"), "src/lib/foo.ts");
  assert.equal(normalizeLcovPath("/abs/path/repo/src/app/page.tsx"), "src/app/page.tsx");
});

test("normalizeLcovPath: a path with no src/ segment (e.g. a test helper outside src) returns null", () => {
  assert.equal(normalizeLcovPath("node_modules/foo/index.js"), null);
});
