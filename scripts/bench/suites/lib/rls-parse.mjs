/**
 * Parsing for the rls-coverage benchmark. Two independent parsers:
 *
 *  1. extractPolicyBearingTables(migrationSqlByFile) — every table named in a
 *     `CREATE POLICY "..." ON "visionquest"."<Table>"` statement, anywhere
 *     across prisma/migrations, deduped. No migration in this repo DROPs a
 *     table that ever had a policy (verified: zero `DROP TABLE` statements
 *     exist in prisma/migrations as of this promotion), and the many
 *     `DROP POLICY` statements are the repo's idempotent "drop it if it
 *     exists, then recreate" pattern for a migration that ALTERS an existing
 *     policy — not a removal. So "any CREATE POLICY mention, ever" is treated
 *     as "currently policy-bearing." If a future migration ever truly retires
 *     RLS from a table (drops its last policy with no replacement), this
 *     heuristic will overcount until it's taught to track net state — flagged
 *     here rather than silently wrong.
 *
 *  2. extractItBlocks(testSource) + classifyBlock(body) — walks every it(...)
 *     call in src/lib/rls.test.ts (regardless of which describe() it sits
 *     under — many blocks are grouped by ROLE, not by table, e.g. "student
 *     role" covers Conversation, Goal, CaseNote, and Student in one describe)
 *     and attributes it to every Prisma model its body queries via
 *     `tx.<model>.` or `prisma.<model>.` (Prisma's default delegate name is
 *     the model name with its first letter lowercased — reversed here by
 *     upper-casing the first letter back).
 *
 * HEURISTIC for positive/negative (stated once, here, per the task's
 * instruction to be explicit about it):
 *   - "positive" = the block asserts a NON-empty/NON-zero result: a `.length`
 *     compared to a digit 1-9, or `assert.deepEqual`/`assert.equal` against a
 *     non-empty array literal (starts with `[` and is not immediately `[]`).
 *   - "negative" = the block asserts an EMPTY/zero/rejected result:
 *     `assert.rejects(`, a `.length`/`.count` compared to literal `0`, or
 *     `assert.deepEqual`/`assert.equal` against an empty array literal `[]`.
 *   A single it() block commonly proves BOTH at once (e.g. "sees only own X"
 *   also implicitly proves "does not see the OTHER student's X" via the same
 *   assertion) — this is intentionally per-TABLE evidence, not per-test:
 *   a table counts as covered once ANY of its attributed blocks shows a
 *   positive signal AND ANY (possibly a different) block shows a negative
 *   signal.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function extractPolicyBearingTables(migrationsDir = "prisma/migrations") {
  const tables = new Set();
  const pattern = /CREATE POLICY\s+"[^"]+"\s+ON\s+"visionquest"\."([^"]+)"/g;
  let dirs;
  try {
    dirs = readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  for (const dir of dirs) {
    const sqlPath = join(migrationsDir, dir.name, "migration.sql");
    let sql;
    try {
      sql = readFileSync(sqlPath, "utf8");
    } catch {
      continue;
    }
    let match;
    while ((match = pattern.exec(sql)) !== null) {
      tables.add(match[1]);
    }
  }
  return [...tables].sort();
}

/** JS-lexeme-aware brace matcher: finds the index of the `}` matching the `{` at openIndex. */
function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let mode = null; // null | "string" | "template" | "line" | "block"
  let quote = null;
  for (let i = openIndex; i < source.length; i++) {
    const c = source[i];
    if (mode === "line") {
      if (c === "\n") mode = null;
      continue;
    }
    if (mode === "block") {
      if (source[i - 1] === "*" && c === "/") mode = null;
      continue;
    }
    if (mode === "string") {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) mode = null;
      continue;
    }
    if (mode === "template") {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === "`") mode = null;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      mode = "line";
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      mode = "block";
      continue;
    }
    if (c === '"' || c === "'") {
      mode = "string";
      quote = c;
      continue;
    }
    if (c === "`") {
      mode = "template";
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const IT_HEAD = /\bit\(\s*(["'`])/g;

/** @returns {Array<{ title: string, body: string }>} */
export function extractItBlocks(testSource) {
  const blocks = [];
  IT_HEAD.lastIndex = 0;
  let match;
  while ((match = IT_HEAD.exec(testSource)) !== null) {
    const quote = match[1];
    const titleStart = match.index + match[0].length;
    const titleEnd = testSource.indexOf(quote, titleStart);
    if (titleEnd === -1) continue;
    const title = testSource.slice(titleStart, titleEnd);

    const arrowIdx = testSource.indexOf("=>", titleEnd);
    if (arrowIdx === -1) continue;
    const openBrace = testSource.indexOf("{", arrowIdx);
    if (openBrace === -1) continue;
    const closeBrace = findMatchingBrace(testSource, openBrace);
    if (closeBrace === -1) continue;

    blocks.push({ title, body: testSource.slice(openBrace, closeBrace + 1) });
    IT_HEAD.lastIndex = closeBrace;
  }
  return blocks;
}

const MODEL_CALL_PATTERN = /\b(?:tx|prisma|prismaAdmin)\.([a-zA-Z][a-zA-Z0-9]*)\./g;

/** Prisma's default delegate name is the model name with its first letter lowercased. */
function delegateNameToModelName(delegate) {
  return delegate.charAt(0).toUpperCase() + delegate.slice(1);
}

/** @returns {string[]} model names (PascalCase) referenced in the block body */
export function modelsReferencedIn(body) {
  const models = new Set();
  let match;
  MODEL_CALL_PATTERN.lastIndex = 0;
  while ((match = MODEL_CALL_PATTERN.exec(body)) !== null) {
    models.add(delegateNameToModelName(match[1]));
  }
  return [...models];
}

const NEGATIVE_PATTERNS = [
  /assert\.rejects\(/,
  /\.(length|count)\s*,\s*0\b/,
  /(?:deepEqual|equal)\([^,]+,\s*\[\]/,
];
const POSITIVE_PATTERNS = [/\.length\s*,\s*[1-9]/, /(?:deepEqual|equal)\([^,]+,\s*\[(?!\])/];

/** @returns {{ positive: boolean, negative: boolean }} */
export function classifyBlock(body) {
  return {
    positive: POSITIVE_PATTERNS.some((re) => re.test(body)),
    negative: NEGATIVE_PATTERNS.some((re) => re.test(body)),
  };
}

/**
 * @param {string[]} policyBearingTables
 * @param {Array<{title: string, body: string}>} itBlocks
 * @returns {{
 *   ratio: number,
 *   coveredTables: string[],
 *   uncoveredTables: string[],
 *   perTable: Record<string, {positiveTests: string[], negativeTests: string[]}>,
 * }}
 */
export function computeRlsCoverage(policyBearingTables, itBlocks) {
  const perTable = Object.fromEntries(
    policyBearingTables.map((t) => [t, { positiveTests: [], negativeTests: [] }]),
  );

  for (const block of itBlocks) {
    const { positive, negative } = classifyBlock(block.body);
    if (!positive && !negative) continue;
    for (const model of modelsReferencedIn(block.body)) {
      const entry = perTable[model];
      if (!entry) continue; // references a non-policy-bearing table (or a helper), not relevant here
      if (positive) entry.positiveTests.push(block.title);
      if (negative) entry.negativeTests.push(block.title);
    }
  }

  const coveredTables = [];
  const uncoveredTables = [];
  for (const table of policyBearingTables) {
    const entry = perTable[table];
    if (entry.positiveTests.length > 0 && entry.negativeTests.length > 0) coveredTables.push(table);
    else uncoveredTables.push(table);
  }

  return {
    ratio: policyBearingTables.length ? coveredTables.length / policyBearingTables.length : 0,
    coveredTables: coveredTables.sort(),
    uncoveredTables: uncoveredTables.sort(),
    perTable,
  };
}
