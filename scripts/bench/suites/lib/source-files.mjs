/**
 * Source-file discovery for the `coverage` benchmark's include-all denominator.
 * A plain recursive walk (no glob dependency) over src/**, filtering to the
 * same "real source, not a test" definition the rest of the repo uses.
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

/**
 * @param {string} root - directory to walk, e.g. "src"
 * @returns {string[]} repo-relative paths (posix-style, forward slashes) of every eligible source file
 */
export function listEligibleSourceFiles(root = "src") {
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
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        out.push(relative(process.cwd(), full).split("\\").join("/"));
      }
    }
  }
  return out.sort();
}
