/**
 * Pure parsers for the readiness scorecard: Node's TAP output, the ops
 * evidence checklist's Markdown tables, and the rule for the whole unit suite.
 * Nothing here runs a process or writes a file.
 */

import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export const verdict = (status, detail) => ({ status, detail });
export const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Read Node's TAP output. `passed` leaves out skipped tests, suites, and the
 * file-level entry Node prints when no test in a file ran: that entry is `ok`
 * with exit code 0, so a name pattern that matches nothing would look green.
 * `failed` leaves out a parent that failed only because a child did.
 */
export function parseTap(text, root) {
  const points = [];
  let yamlIndent = null;
  for (const line of text.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (yamlIndent !== null) {
      const field = indent === yamlIndent && line.trim().match(/^(type|location|failureType): '(.*)'$/);
      if (field) points.at(-1)[field[1]] = field[2];
      if (indent === yamlIndent && line.trim() === "...") yamlIndent = null;
      continue;
    }
    const point = line.trim().match(/^(not ok|ok) \d+ - (.*)$/);
    if (point) points.push({ ok: point[1] === "ok", raw: point[2] });
    else if (line.trim() === "---" && points.length > 0) yamlIndent = indent;
  }
  const named = points.map((point) => ({
    ...point,
    name: point.raw.replace(/ # (SKIP|TODO).*$/i, "").replace(/\\([\\#])/g, "$1"),
    file: point.location ? relative(root, point.location.replace(/:\d+:\d+$/, "")).split(sep).join("/") : "",
  }));
  // Node names the file-level entry by the path it was given, absolute or relative to the run's cwd.
  const isFileEntry = (point) => existsSync(resolve(root, point.name));
  const passed = named.filter((p) => p.ok && p.type !== "suite" && !/ # (SKIP|TODO)/i.test(p.raw) && !isFileEntry(p));
  return { passed, failed: named.filter((point) => !point.ok && point.failureType !== "subtestsFailed") };
}

/** The whole unit suite passes only when every failing test is a known sandbox-only failure. */
export function judgeUnitSuite(tap, exitCode, known) {
  const isKnown = (failure) => known.some((entry) => entry.file === failure.file && entry.name === failure.name);
  const unexpected = tap.failed.filter((failure) => !isKnown(failure));
  if (unexpected.length > 0) {
    const names = unexpected.slice(0, 5).map((failure) => `${failure.file}: ${failure.name}`);
    return verdict("fail", `${unexpected.length} unexpected failing ${unexpected.length === 1 ? "test" : "tests"}: ${names.join("; ")}`);
  }
  if (tap.passed.length === 0) return verdict("fail", "no test matched");
  if (exitCode !== 0 && tap.failed.length === 0) return verdict("fail", `exit ${exitCode} with no failing test in the output`);
  return verdict("pass", `${tap.passed.length} passed, ${plural(tap.failed.length, "known sandbox-only failure")}`);
}

/** Every data row of every Markdown table in the text, with its table's header cells. */
export function tableRows(markdown) {
  const rows = [];
  let header = null; // null outside a table
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) {
      header = null;
      continue;
    }
    const cells = line.trim().slice(1).replace(/\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim());
    if (header === null) header = cells;
    else if (!cells.every((cell) => /^:?-+:?$/.test(cell))) rows.push({ header, cells });
  }
  return rows;
}

/** Rows of every table that has a Result column: first cell to its Result cells. */
export function parseChecklist(markdown) {
  const results = new Map();
  for (const { header, cells } of tableRows(markdown)) {
    const column = header.indexOf("Result");
    if (column >= 0) results.set(cells[0], [...(results.get(cells[0]) ?? []), cells[column] ?? ""]);
  }
  return results;
}
