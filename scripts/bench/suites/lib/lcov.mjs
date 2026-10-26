/**
 * Minimal LCOV parser for Node's built-in `--test-reporter=lcov` output
 * (see https://nodejs.org/api/test.html — the test runner ships an lcov
 * reporter; no third-party dependency needed).
 *
 * Only reads the per-file line-coverage totals (LF/LH) and per-line hit
 * counts (DA) — everything the coverage benchmark needs. Function/branch
 * records are ignored (parsed harmlessly if present, never asserted on).
 */

/**
 * @param {string} lcovText
 * @returns {Array<{ file: string, linesFound: number, linesHit: number, lines: Map<number, number> }>}
 */
export function parseLcov(lcovText) {
  const records = [];
  let current = null;

  for (const rawLine of lcovText.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      current = { file: line.slice(3), linesFound: 0, linesHit: 0, lines: new Map() };
      records.push(current);
    } else if (line.startsWith("DA:") && current) {
      const [lineNoStr, hitsStr] = line.slice(3).split(",");
      current.lines.set(Number(lineNoStr), Number(hitsStr));
    } else if (line.startsWith("LF:") && current) {
      current.linesFound = Number(line.slice(3));
    } else if (line.startsWith("LH:") && current) {
      current.linesHit = Number(line.slice(3));
    } else if (line === "end_of_record") {
      current = null;
    }
  }

  return records;
}

/**
 * Normalizes an LCOV `SF:` path (which node's lcov reporter writes relative
 * to the reporter destination file's directory, e.g.
 * "../../src/lib/foo.ts") to a repo-root-relative path (e.g. "src/lib/foo.ts")
 * by matching on the first occurrence of `anchor` (default "src/").
 */
export function normalizeLcovPath(sfPath, anchor = "src/") {
  const idx = sfPath.indexOf(anchor);
  if (idx === -1) return null;
  return sfPath.slice(idx);
}
