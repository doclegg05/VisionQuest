// =============================================================================
// "Does every surface still count ALL orientation items?"
//
// The 2026-07-31 decision: readiness counts ALL orientation items on every
// surface. It exists because a per-surface split — the KPI report counting only
// REQUIRED items while the dashboard, class-progress panel and profile counted
// every item — showed the same student different scores on different screens.
//
// The split lived in the QUERY, not in the scoring code, so no amount of
// unit-testing the scorer would catch it coming back. What catches it is
// reading the call sites: a `where` on the query that supplies the denominator
// is the regression, whatever the clause happens to say.
//
// Deliberately a source check rather than a runtime one. The alternative needs
// a database with orientation items seeded in two shapes, which puts the
// decision's only guard behind an environment most machines do not have — and
// a guard that reports `skipped` is not a guard.
// =============================================================================

/** Prisma reads that can supply the orientation denominator. */
const DENOMINATOR_METHODS = ["count", "findMany"];

/**
 * Text between the parentheses of `call(` at `openIndex`, balanced across
 * nested braces, brackets and parens.
 *
 * A regex up to the first `)` gets `count({ where: { OR: [{ b: fn(2) }] } })`
 * wrong and would report the most interesting case as clean. Returns null for
 * an unterminated call rather than running to the end of the file.
 *
 * @param {string} source
 * @param {number} openIndex index of the `(`
 * @returns {{ args: string, end: number } | null}
 */
function balancedArgs(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(" || character === "{" || character === "[") depth += 1;
    else if (character === ")" || character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) {
        return { args: source.slice(openIndex + 1, index).trim(), end: index };
      }
    }
  }
  return null;
}

/**
 * Every `orientationItem.count(…)` / `orientationItem.findMany(…)` in one
 * file's source, with the argument text and whether it filters.
 *
 * `narrowed` is "the argument mentions `where`". Coarse on purpose: any filter
 * on the denominator query is the thing the decision forbids, and enumerating
 * which clauses are acceptable would be a list to keep in step with Prisma.
 *
 * @param {string} source
 * @returns {{ method: string, args: string, narrowed: boolean, line: number }[]}
 */
export function findOrientationDenominatorCalls(source) {
  const calls = [];
  const pattern = /orientationItem\s*\.\s*(count|findMany)\s*\(/gu;

  for (const match of source.matchAll(pattern)) {
    const method = match[1];
    if (!DENOMINATOR_METHODS.includes(method)) continue;

    const openIndex = match.index + match[0].length - 1;
    const balanced = balancedArgs(source, openIndex);
    if (!balanced) continue;

    calls.push({
      method,
      args: balanced.args,
      narrowed: /\bwhere\b/u.test(balanced.args),
      line: source.slice(0, match.index).split("\n").length,
    });
  }

  return calls;
}

/**
 * The offenders across the declared call sites.
 *
 * A file with NO denominator call is an offender too: the fixture names the
 * places the decision applies, so a call site that moved means the check is
 * reading the wrong file, and a silent pass there measures nothing.
 *
 * @param {{ path: string, source: string }[]} files
 * @returns {{ path: string, line: number|null, filter: string }[]}
 */
export function narrowedDenominators(files) {
  const offenders = [];

  for (const file of files) {
    const calls = findOrientationDenominatorCalls(file.source);
    if (calls.length === 0) {
      offenders.push({
        path: file.path,
        line: null,
        filter: "no orientationItem denominator call found",
      });
      continue;
    }
    for (const call of calls) {
      if (!call.narrowed) continue;
      offenders.push({ path: file.path, line: call.line, filter: call.args });
    }
  }

  return offenders;
}
