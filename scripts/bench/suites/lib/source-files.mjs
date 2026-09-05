/**
 * Source-file discovery for the `coverage` benchmark: the include-all line-
 * coverage denominator (`listEligibleSourceFiles`) and the BFS roots for the
 * static untested-modules import-graph walk (`listTestFiles`). A plain
 * recursive walk (no glob dependency) over src/**, filtering to the same
 * "real source, not a test" definition the rest of the repo uses.
 */

import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

const TEST_SUFFIXES = [".test.ts", ".test.tsx"];
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function isTestFile(filename) {
  return TEST_SUFFIXES.some((suffix) => filename.endsWith(suffix));
}

function isDeclarationFile(filename) {
  return filename.endsWith(".d.ts");
}

function isSourceFile(filename) {
  return SOURCE_EXTENSIONS.some((ext) => filename.endsWith(ext)) && !isTestFile(filename) && !isDeclarationFile(filename);
}

/** @param {string} root @param {(filename: string) => boolean} predicate @returns {string[]} */
function walk(root, predicate) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && predicate(entry.name)) {
        out.push(relative(process.cwd(), full).split("\\").join("/"));
      }
    }
  }
  return out.sort();
}

/**
 * @param {string} root - directory to walk, e.g. "src"
 * @returns {string[]} repo-relative paths (posix-style, forward slashes) of every eligible non-test source file
 */
export function listEligibleSourceFiles(root = "src") {
  return walk(root, isSourceFile);
}

/**
 * @param {string} root - directory to walk, e.g. "src"
 * @returns {string[]} repo-relative paths of every `*.test.ts(x)` file — the
 *   BFS roots for the untested-modules import-graph walk.
 */
export function listTestFiles(root = "src") {
  return walk(root, isTestFile);
}
