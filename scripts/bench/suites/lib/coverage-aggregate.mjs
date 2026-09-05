/**
 * Pure aggregation over parsed LCOV records + the eligible-file list. Kept
 * separate from I/O (spawning tsx, reading the lcov file) so it can be
 * unit-tested directly.
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
 *   untestedModules: string[],
 *   coveredZeroHitFiles: string[],
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
  const coveredZeroHitFiles = [];
  for (const record of byPath.values()) {
    totalLinesFound += record.linesFound;
    totalLinesHit += record.linesHit;
    if (record.linesHit === 0) coveredZeroHitFiles.push(record.file);
  }

  const missingEntirely = eligibleFiles.filter((f) => !byPath.has(f));
  const untestedModules = [...missingEntirely, ...coveredZeroHitFiles].sort();

  return {
    totalLinesFound,
    totalLinesHit,
    coverageRatio: totalLinesFound > 0 ? totalLinesHit / totalLinesFound : 0,
    reportedFileCount: byPath.size,
    eligibleFileCount: eligibleFiles.length,
    untestedModules,
    coveredZeroHitFiles,
  };
}
