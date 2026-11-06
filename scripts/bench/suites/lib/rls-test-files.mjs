/**
 * Which files the rls-coverage benchmark reads. The list is derived from the
 * `test:rls` script in package.json, so a new RLS test file added to that
 * script is counted without a second list to keep in step.
 */

import { readFileSync } from "node:fs";

/** Test files named by the `test:rls` script (any argument ending in `.test.ts`). */
export function parseRlsTestPaths(testRlsScript) {
  return String(testRlsScript)
    .split(/\s+/)
    .filter((token) => /\.test\.(ts|mjs)$/.test(token));
}

export function readRlsTestPaths(packageJsonPath = "package.json") {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const script = pkg?.scripts?.["test:rls"];
  if (typeof script !== "string") {
    throw new Error(`${packageJsonPath} has no "test:rls" script`);
  }
  const paths = parseRlsTestPaths(script);
  if (paths.length === 0) {
    throw new Error(`"test:rls" in ${packageJsonPath} names no test files`);
  }
  return paths;
}

/** All it() blocks across the given files, in file order. */
export function extractItBlocksFromFiles(paths, extractItBlocks, read = (p) => readFileSync(p, "utf8")) {
  return paths.flatMap((path) => extractItBlocks(read(path)));
}
