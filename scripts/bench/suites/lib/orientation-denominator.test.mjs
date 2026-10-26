import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findOrientationDenominatorCalls, narrowedDenominators } from "./orientation-denominator.mjs";

describe("findOrientationDenominatorCalls", () => {
  it("finds a bare count() and reports no filter", () => {
    const calls = findOrientationDenominatorCalls("const n = await prisma.orientationItem.count();");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "count");
    assert.equal(calls[0].args, "");
    assert.equal(calls[0].narrowed, false);
  });

  it("finds a findMany with only orderBy and reports no filter", () => {
    const calls = findOrientationDenominatorCalls(
      'prisma.orientationItem.findMany({\n  orderBy: { sortOrder: "asc" },\n})',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "findMany");
    assert.equal(calls[0].narrowed, false);
  });

  it("reports a where clause as narrowed — this is the 2026-07-31 regression", () => {
    const calls = findOrientationDenominatorCalls(
      "prisma.orientationItem.count({ where: { required: true } })",
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].narrowed, true);
    assert.match(calls[0].args, /required/u);
  });

  it("balances nested braces and parentheses rather than stopping at the first )", () => {
    const calls = findOrientationDenominatorCalls(
      "prisma.orientationItem.count({ where: { OR: [{ a: 1 }, { b: fn(2) }] } })",
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].narrowed, true);
    assert.match(calls[0].args, /fn\(2\)/u);
  });

  it("finds several calls in one file and keeps their line numbers", () => {
    const source = [
      "const a = await prisma.orientationItem.count();",
      "",
      "const b = await prisma.orientationItem.count({ where: { x: 1 } });",
    ].join("\n");
    const calls = findOrientationDenominatorCalls(source);
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((call) => [call.line, call.narrowed]),
      [
        [1, false],
        [3, true],
      ],
    );
  });

  it("ignores an unterminated call rather than swallowing the rest of the file", () => {
    assert.deepEqual(findOrientationDenominatorCalls("prisma.orientationItem.count({ where: {"), []);
  });

  it("ignores a different model", () => {
    assert.deepEqual(
      findOrientationDenominatorCalls("prisma.orientationProgress.count({ where: { completed: true } })"),
      [],
    );
  });
});

describe("narrowedDenominators", () => {
  it("names the file, line and filter of every narrowed call", () => {
    const offenders = narrowedDenominators([
      { path: "clean.ts", source: "prisma.orientationItem.count()" },
      {
        path: "narrowed.ts",
        source: "\nprisma.orientationItem.count({ where: { required: true } })",
      },
    ]);
    assert.equal(offenders.length, 1);
    assert.equal(offenders[0].path, "narrowed.ts");
    assert.equal(offenders[0].line, 2);
    assert.match(offenders[0].filter, /required/u);
  });

  it("treats a declared call site with no call at all as an offender", () => {
    // A file that stopped supplying the denominator is not "clean" — it means
    // the fixture is naming a call site that moved, and a check that silently
    // passed would be measuring nothing.
    const offenders = narrowedDenominators([{ path: "moved.ts", source: "// nothing here" }]);
    assert.equal(offenders.length, 1);
    assert.equal(offenders[0].filter, "no orientationItem denominator call found");
  });
});
