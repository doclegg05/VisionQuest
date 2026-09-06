/**
 * Static import-graph reachability for the `coverage` benchmark's
 * `untested_modules` metric.
 *
 * Answers the design's actual definition (table 4.11: "source files with
 * zero IMPORTING tests") rather than the force-import approximation this
 * suite shipped with first: force-importing a file always gives it a
 * nonzero line-hit count (a bare `import` executes the module's top-level
 * statements), so that approach measured 0/842 untested modules even though
 * hundreds of files are never loaded by the real `npm test` run. This module
 * instead walks the import graph FROM every `*.test.ts(x)` file, following
 * only `@/` (mapped to `src/`, per tsconfig's `paths`) and relative
 * (`./`, `../`) specifiers — bare specifiers (`react`, `@prisma/client`,
 * `node:fs`, …) are external packages and are not part of this graph. A
 * source file the graph never reaches, starting from any test file, is
 * "untested" by this metric: not even a syntax-level import chain connects
 * it to a test.
 *
 * This is a STATIC analysis: it never imports or executes anything, so it
 * cannot know about conditional/dynamic imports built from a non-literal
 * expression, code-generation, or the app's own runtime wiring for
 * server-only helpers Next.js loads outside a plain `import`. Those would
 * read as "untested" even if some other mechanism exercises them; this is
 * the same over-conservative direction as the force-import approach's
 * under-conservative one, and — like that one — is stated here rather than
 * discovered by a reader later.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const INDEX_CANDIDATES = SOURCE_EXTENSIONS.map((ext) => `index${ext}`);

/**
 * Every import/export/dynamic-import/require specifier literal in a source
 * file's text. Regex-based (no TypeScript parser dependency) — good enough
 * for specifier extraction since specifiers are always plain string
 * literals in valid TS/JS, regardless of what else is on the line.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function extractImportSpecifiers(source) {
  const specifiers = [];
  const pattern =
    /(?:^|\s)(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/gm;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    specifiers.push(match[1] ?? match[2]);
  }
  return specifiers;
}

/**
 * Resolves one import specifier from `fromFile` (a repo-relative path) to a
 * repo-relative source file path, or null when it's external (a bare
 * specifier), unresolvable, or points outside `src/`.
 *
 * @param {string} specifier
 * @param {string} fromFile - repo-relative path of the importing file
 * @param {string} repoRoot - absolute path the repo-relative paths are under
 * @returns {string|null}
 */
export function resolveSpecifier(specifier, fromFile, repoRoot) {
  let base;
  if (specifier.startsWith("@/")) {
    base = join("src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = join(dirname(fromFile), specifier);
  } else {
    return null; // bare specifier: an external package, not part of this graph
  }
  base = normalize(base).split("\\").join("/");

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...INDEX_CANDIDATES.map((name) => join(base, name).split("\\").join("/")),
  ];
  for (const candidate of candidates) {
    const abs = join(repoRoot, candidate);
    // A bare directory match (candidate === base, no extension) must fall
    // through to the index-file candidates below it, not resolve to the
    // directory itself — existsSync alone can't tell a directory from a file.
    if (existsSync(abs) && statSync(abs).isFile()) return candidate;
  }
  return null;
}

/**
 * BFS over the import graph starting at `rootFiles` (repo-relative paths,
 * typically every `*.test.ts(x)` file), returning the full set of
 * repo-relative files reached (including the roots themselves).
 *
 * @param {object} opts
 * @param {string[]} opts.rootFiles
 * @param {string} opts.repoRoot
 * @returns {Set<string>}
 */
export function buildReachableSet({ rootFiles, repoRoot }) {
  const reached = new Set();
  const queue = [...rootFiles];
  while (queue.length > 0) {
    const file = queue.shift();
    if (reached.has(file)) continue;
    reached.add(file);

    let source;
    try {
      source = readFileSync(join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    for (const specifier of extractImportSpecifiers(source)) {
      const resolved = resolveSpecifier(specifier, file, repoRoot);
      if (resolved && !reached.has(resolved)) queue.push(resolved);
    }
  }
  return reached;
}

/**
 * @param {object} opts
 * @param {string[]} opts.eligibleFiles - repo-relative non-test source files (the denominator)
 * @param {string[]} opts.testFiles - repo-relative *.test.ts(x) files (the BFS roots)
 * @param {string} opts.repoRoot
 * @returns {{ untestedModules: string[], reachableCount: number, eligibleCount: number }}
 */
export function computeUntestedModules({ eligibleFiles, testFiles, repoRoot }) {
  const reached = buildReachableSet({ rootFiles: testFiles, repoRoot });
  const reachableEligible = eligibleFiles.filter((f) => reached.has(f));
  const untestedModules = eligibleFiles.filter((f) => !reached.has(f)).sort();
  return {
    untestedModules,
    reachableCount: reachableEligible.length,
    eligibleCount: eligibleFiles.length,
  };
}

// Re-exported for callers that already have a relative-path helper elsewhere
// and want the same posix-slash normalization this module uses internally.
export function toPosixRelative(repoRoot, absPath) {
  return relative(repoRoot, absPath).split("\\").join("/");
}
