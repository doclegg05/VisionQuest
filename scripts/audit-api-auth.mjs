/**
 * Walks `src/app/api/**\/route.ts` and classifies every exported HTTP handler
 * by its auth wrapper. Reports at two levels of alarm:
 *
 *   OK        handler is wrapped by withAuth / withTeacherAuth / withAdminAuth
 *             (RLS context is guaranteed before Prisma runs)
 *   NOTE      handler is unwrapped / uses withErrorHandler with no Prisma
 *             (legit for unauthenticated endpoints — login, csp-report, etc.)
 *   WARN      handler uses a bare handler with no wrapper at all
 *             (no standardized error handling)
 *   FOOTGUN   handler uses withErrorHandler AND imports `prisma` from @/lib/db
 *             (this is the 2026-04-24 RLS footgun — under vq_app every query
 *             silently returns filtered/empty results because no RLS context
 *             is ever set)
 *
 * Exits 1 when any FOOTGUN matches, for CI gating.
 *
 * Usage:
 *   node scripts/audit-api-auth.mjs                      human-readable report
 *   node scripts/audit-api-auth.mjs --markdown           markdown table
 *   node scripts/audit-api-auth.mjs --json               raw findings
 */

import { readFile } from "fs/promises";
import { glob } from "glob";
import { relative } from "path";

const ROOT = process.cwd();
const MODE = process.argv.includes("--markdown")
  ? "markdown"
  : process.argv.includes("--json")
    ? "json"
    : "human";

const HTTP_VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

// Regex that captures the wrapper immediately after `export const VERB =`
// Examples matched:
//   export const GET = withAuth(async (session) => { ... })
//   export const POST = withTeacherAuth(async (session, req) => { ... })
//   export const DELETE = withErrorHandler(async (req) => { ... })
//   export const GET = async (req) => { ... }                (bare — WARN)
function findHandlers(src) {
  const handlers = [];
  const re = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*=\s*(\w+)?\s*\(?/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, verb, next] = m;
    // If `next` is `async` or `function`, it's a bare handler; otherwise it's
    // the wrapper identifier.
    const wrapper = next === "async" || next === "function" ? null : next ?? null;
    handlers.push({ verb, wrapper });
  }
  return handlers;
}

// Wrappers that run the handler inside `withRlsContext`. Keep this list
// in sync with src/lib/api-error.ts + adjacent wrapper modules.
const OK_WRAPPERS = new Set([
  "withAuth",
  "withTeacherAuth",
  "withAdminAuth",
  "withCoordinatorAuth",
  "withRegistry", // sets RLS context since fix(rls) in the registry middleware
]);
// Wrappers that are legitimate for unauthenticated endpoints only.
const UNAUTH_WRAPPERS = new Set(["withErrorHandler", "withRegistryPublic"]);

function classify(src, handler) {
  const w = handler.wrapper;
  if (OK_WRAPPERS.has(w)) return { level: "OK", note: w };
  if (UNAUTH_WRAPPERS.has(w)) {
    const usesPrisma = /from ["']@\/lib\/db["']/.test(src) && /\bprisma\./.test(src);
    const callsGetSession = /\bgetSession\(\)/.test(src);
    if (usesPrisma && callsGetSession) {
      return {
        level: "FOOTGUN",
        note: `${w} + getSession() + prisma — RLS context never set`,
      };
    }
    return { level: "NOTE", note: `${w} (no prisma + no session)` };
  }
  if (w === null) return { level: "WARN", note: "bare handler, no wrapper" };
  // Unknown wrapper — could be a project-local helper; flag as NOTE.
  return { level: "NOTE", note: `unknown wrapper: ${w}` };
}

async function main() {
  const files = await glob("src/app/api/**/route.ts", { cwd: ROOT, absolute: true });
  const findings = [];

  for (const abs of files.sort()) {
    const src = await readFile(abs, "utf-8");
    const handlers = findHandlers(src);
    if (handlers.length === 0) continue;
    const rel = relative(ROOT, abs).replace(/\\/g, "/");
    for (const h of handlers) {
      const c = classify(src, h);
      findings.push({ file: rel, verb: h.verb, wrapper: h.wrapper, ...c });
    }
  }

  const counts = { OK: 0, NOTE: 0, WARN: 0, FOOTGUN: 0 };
  for (const f of findings) counts[f.level]++;

  if (MODE === "json") {
    console.log(JSON.stringify({ counts, findings }, null, 2));
  } else if (MODE === "markdown") {
    console.log(`# API route auth audit\n`);
    console.log(
      `| Level | Count |\n|---|---|\n| OK | ${counts.OK} |\n| NOTE | ${counts.NOTE} |\n| WARN | ${counts.WARN} |\n| **FOOTGUN** | **${counts.FOOTGUN}** |\n`,
    );
    const bad = findings.filter((f) => f.level === "FOOTGUN" || f.level === "WARN");
    if (bad.length) {
      console.log(`## Findings needing attention\n`);
      console.log(`| Level | File | Verb | Wrapper | Note |`);
      console.log(`|---|---|---|---|---|`);
      for (const f of bad) {
        console.log(`| ${f.level} | \`${f.file}\` | ${f.verb} | ${f.wrapper ?? "(bare)"} | ${f.note} |`);
      }
    } else {
      console.log("No FOOTGUN or WARN findings — audit clean.");
    }
  } else {
    console.log(
      `API route auth audit — ${files.length} route files, ${findings.length} handlers`,
    );
    console.log(`  OK:      ${counts.OK}`);
    console.log(`  NOTE:    ${counts.NOTE}`);
    console.log(`  WARN:    ${counts.WARN}`);
    console.log(`  FOOTGUN: ${counts.FOOTGUN}`);
    const bad = findings.filter((f) => f.level === "FOOTGUN" || f.level === "WARN");
    if (bad.length) {
      console.log(`\nFindings needing attention:\n`);
      for (const f of bad) {
        console.log(`  [${f.level}] ${f.file} ${f.verb} — ${f.note}`);
      }
    } else {
      console.log(`\nAll handlers wrapped correctly.`);
    }
  }

  if (counts.FOOTGUN > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
