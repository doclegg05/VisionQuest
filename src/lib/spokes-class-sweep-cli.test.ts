// src/lib/spokes-class-sweep-cli.test.ts
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = "scripts/spokes-class-sweep.mjs";
const ORIGINAL = 'const a = "bg-red-50";\n';
const REWRITTEN = 'const a = "bg-danger-soft";\n';

let dir = "";

function sweep(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: process.cwd(), encoding: "utf8" });
}

function writeFixture(name: string, text = ORIGINAL) {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

describe("spokes-class-sweep CLI", () => {
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "spokes-sweep-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("dry run reports the change and leaves the file byte-identical", () => {
    const file = writeFixture("a.tsx");
    const result = sweep(`--paths=${dir}/a.tsx`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /would rewrite 1 of 1/);
    assert.equal(readFileSync(file, "utf8"), ORIGINAL);
  });

  it("--write rewrites the class to its SPOKES role", () => {
    const file = writeFixture("a.tsx");
    const result = sweep(`--paths=${dir}/a.tsx`, "--write");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(file, "utf8"), REWRITTEN);
  });

  it("skips a .test.tsx file, so a glob that matches only it exits 2", () => {
    writeFixture("a.test.tsx");
    const result = sweep(`--paths=${dir}/a.test.tsx`);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no files matched/);
  });

  it("skips .d.ts files and anything under node_modules", () => {
    writeFixture("types.d.ts", 'declare const x: "bg-red-50";\n');
    writeFixture("node_modules/lib/index.tsx");
    assert.equal(sweep(`--paths=${dir}/types.d.ts`).status, 2);
    assert.equal(sweep(`--paths=${dir}/node_modules/**/*.tsx`).status, 2);
  });

  it("exits 2 when the glob matches nothing", () => {
    const result = sweep(`--paths=${dir}/nothing/*.tsx`);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no files matched/);
  });

  it("exits 2 on an unknown flag", () => {
    const result = sweep(`--paths=${dir}/a.tsx`, "--bogus");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--bogus/);
  });
});
