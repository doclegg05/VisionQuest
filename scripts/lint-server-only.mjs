#!/usr/bin/env node
/**
 * lint-server-only — guard against client bundles importing `prisma`.
 *
 * Walks src/lib/**\/*.ts and flags any module that:
 *   1. imports the prisma client (from @/lib/db, ./db, or ../db), AND
 *   2. does NOT have `import "server-only"` (or single-quoted variant)
 *      on a top-level line near the head of the file.
 *
 * The `server-only` module throws at build time if a flagged file is
 * pulled into a client component bundle, which keeps Prisma — and the
 * DATABASE_URL credentials it carries — from leaking into the browser.
 *
 * No external dependencies. Plain Node fs/path.
 *
 * Modes:
 *   - default (warn mode): print violations but exit 0
 *   - --strict (or LINT_SERVER_ONLY_STRICT=1): exit 1 on any violation
 *
 * Sprint 2 baseline note: ~57 src/lib/** files import prisma and only ~3
 * have `import "server-only"`. Bundle #1 / PR #41 was supposed to add
 * the guard to the worst offenders. Until that lands on main, the
 * default `npm run lint:server-only` ships in warn mode so the lint
 * pipeline does not turn red. Once the backlog clears, swap the default
 * `lint` script to call `lint:server-only:strict` instead.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const ROOT = process.cwd();
const LIB_DIR = join(ROOT, "src", "lib");
const HEAD_LINES = 50; // import "server-only" is conventionally near the top

// Match `import "server-only"` or `import 'server-only'` on its own line.
const SERVER_ONLY_RE = /^\s*import\s+["']server-only["']\s*;?\s*$/m;

// Match imports that resolve to the prisma client module.
//   from "@/lib/db"  → tsconfig path alias
//   from "./db"      → same dir
//   from "../db"     → parent dir
//   from "../../lib/db" → deeper relative
// We deliberately use a coarse regex over the import statement form rather
// than trying to fully resolve module specifiers — false positives are fine
// here since `import "server-only"` is harmless when applied broadly.
const DB_IMPORT_RES = [
  /from\s+["']@\/lib\/db["']/,
  /from\s+["']\.{1,2}\/db["']/,
  /from\s+["']\.{1,2}(?:\/[\w-]+)+\/db["']/,
];

function isLibTsFile(absPath) {
  if (!absPath.endsWith(".ts")) return false;
  if (absPath.endsWith(".test.ts")) return false;
  if (absPath.endsWith(".d.ts")) return false;
  if (absPath.split(sep).includes("__tests__")) return false;
  return true;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(dir, entry);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walk(abs);
    } else if (stat.isFile()) {
      yield abs;
    }
  }
}

function fileImportsDb(headText) {
  return DB_IMPORT_RES.some((re) => re.test(headText));
}

function fileHasServerOnlyMarker(headText) {
  return SERVER_ONLY_RE.test(headText);
}

function readHead(absPath) {
  const text = readFileSync(absPath, "utf8");
  // Cap at first HEAD_LINES lines for the server-only check, but we still
  // need full text to find db imports anywhere near the top imports block.
  const lines = text.split(/\r?\n/);
  const head = lines.slice(0, HEAD_LINES).join("\n");
  return { head, full: text };
}

function main() {
  const violations = [];
  for (const abs of walk(LIB_DIR)) {
    if (!isLibTsFile(abs)) continue;
    const { head, full } = readHead(abs);
    if (!fileImportsDb(full)) continue;
    if (fileHasServerOnlyMarker(head)) continue;
    violations.push(abs);
  }

  const strict =
    process.argv.includes("--strict") ||
    process.env.LINT_SERVER_ONLY_STRICT === "1";

  if (violations.length === 0) {
    console.log("[lint-server-only] OK — every db-importing src/lib file has `import \"server-only\"`.");
    process.exit(0);
  }

  console.error(
    `[lint-server-only] ${violations.length} file(s) import the prisma client without \`import "server-only"\`:`
  );
  for (const v of violations) {
    const rel = v.startsWith(ROOT) ? v.slice(ROOT.length + 1) : v;
    console.error(`  ${rel}`);
  }
  console.error(
    "\nFix: add `import \"server-only\";` as the first import in each flagged file."
  );

  if (!strict) {
    console.error(
      "\n[lint-server-only] running in warn mode — exiting 0. Pass --strict (or set LINT_SERVER_ONLY_STRICT=1) to enforce."
    );
    process.exit(0);
  }
  process.exit(1);
}

main();
