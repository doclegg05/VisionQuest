/**
 * Pure aggregation over parsed LCOV records + the eligible-file list. Kept
 * separate from I/O (spawning tsx, reading the lcov file) so it can be
 * unit-tested directly.
 *
 * Feeds only the `line_coverage` metric. The `untested_modules` metric is a
 * SEPARATE, static computation (see lib/import-graph.mjs) — this module's
 * `forceImportZeroCoverageFiles` is deliberately not that metric: because a
 * bare `import` always executes a module's top-level statements, a file
 * force-imported here (see lib/generate-import-all.mjs) usually reads a
 * nonzero line-hit count even when no real test calls into it, so this list
 * under-counts "untested" — it only catches outright import failures and
 * files with truly nothing at module scope. Kept as a coverage-side
 * diagnostic, not renamed to `untestedModules` any more, to stop it looking
 * like the benchmark metric of the same name.
 */

import { normalizeLcovPath } from "./lcov.mjs";

/**
 * @param {string[]} eligibleFiles - repo-relative source file paths (the include-all denominator)
 * @param {Array<{file: string, linesFound: number, linesHit: number}>} lcovRecords
 * @returns {{
 *   totalLinesFound: number,
 *   totalLinesHit: number,
 *   coverageRatio: number,
 *   reportedFileCount: number,
 *   eligibleFileCount: number,
 *   forceImportZeroCoverageFiles: string[],
 * }}
 */
export function aggregateCoverage(eligibleFiles, lcovRecords) {
  const eligibleSet = new Set(eligibleFiles);
  const byPath = new Map();
  for (const record of lcovRecords) {
    const normalized = normalizeLcovPath(record.file);
    if (!normalized || !eligibleSet.has(normalized)) continue; // skip test files, node_modules, etc.
    // A file can appear twice in one lcov output if isolated per-test-file
    // instrumentation double-counts it; keep the entry with more lines found
    // (the fuller instrumentation) rather than silently summing duplicates.
    const existing = byPath.get(normalized);
    if (!existing || record.linesFound > existing.linesFound) {
      byPath.set(normalized, record);
    }
  }

  let totalLinesFound = 0;
  let totalLinesHit = 0;
  const zeroHitFiles = [];
  for (const record of byPath.values()) {
    totalLinesFound += record.linesFound;
    totalLinesHit += record.linesHit;
    if (record.linesHit === 0) zeroHitFiles.push(record.file);
  }

  const missingEntirely = eligibleFiles.filter((f) => !byPath.has(f));
  const forceImportZeroCoverageFiles = [...missingEntirely, ...zeroHitFiles].sort();

  return {
    totalLinesFound,
    totalLinesHit,
    coverageRatio: totalLinesFound > 0 ? totalLinesHit / totalLinesFound : 0,
    reportedFileCount: byPath.size,
    eligibleFileCount: eligibleFiles.length,
    forceImportZeroCoverageFiles,
  };
}
