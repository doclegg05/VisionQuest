/**
 * Guards a measurement against a missing fixture. A call no fixture answers
 * gets the counter's empty default, so the code under test takes its "nothing
 * there" branch and any work that only happens with rows goes uncounted. The
 * counter already counts such a call's own nested loads in full; this check
 * makes the test name every one, so a reader decides whether real data would
 * send more. Test support for the readiness query counts.
 */
import type { RecordedQuery } from "@/lib/query-counter.test-support";

/** "model.operation" -> why the measured path leaves it unanswered. */
export type UnansweredAllowances = Readonly<Record<string, string>>;

function callName(query: RecordedQuery): string {
  return `${query.model}.${query.operation}`;
}

/**
 * One line per unanswered call that loads a nested relation and is not
 * allowed by name, plus one per allowance with no reason or no such call.
 * Empty when the path is clean.
 */
export function unansweredLoadProblems(
  queries: readonly RecordedQuery[],
  allowed: UnansweredAllowances,
): string[] {
  const hiding = queries.filter((query) => query.answeredBy === "default" && query.relationLoads > 0);
  const names = new Set(hiding.map(callName));
  const unlisted = hiding
    .filter((query) => !Object.hasOwn(allowed, callName(query)))
    .map((query) =>
      `${callName(query)} at ${query.caller.file}:${query.caller.line} has ${query.relationLoads} nested relation` +
      `${query.relationLoads === 1 ? "" : "s"} and no fixture: give it one, or allow it by name with a reason`);
  const allowances = Object.entries(allowed).flatMap(([name, reason]) => {
    if (reason.trim() === "") return [`${name} is allowed unanswered with no reason`];
    if (!names.has(name)) return [`${name} is allowed unanswered, but no unanswered call with nested relations has that name`];
    return [];
  });
  return [...unlisted, ...allowances];
}
