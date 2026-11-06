#!/usr/bin/env node
/**
 * List RLS policy branches that admit the `teacher` RLS role without going
 * through visionquest.managed_student_ids.
 *
 * Since the organization tree (migration 20261107120000) both coordinator
 * roles read as `teacher`, so every branch this prints is open to them at the
 * database layer, guarded only by the app layer. Review each one.
 *
 *   node scripts/rls-teacher-branches.mjs            # markdown table on stdout
 *
 * It replays every `CREATE POLICY` / `DROP POLICY` in
 * prisma/migrations/<folder>/migration.sql in folder order, keeps the latest
 * definition per (table, policy), then inspects each USING and WITH CHECK
 * expression. A teacher arm is the OR-term that holds the role check. It
 * "goes through" managed_student_ids when every OR path inside it does:
 *   none    - the arm never calls managed_student_ids
 *   partial - it calls it, but another path (an OR, or CASE ... ELSE true)
 *             admits rows without it
 * Plain Node, no dependencies.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TEACHER_CHECK =
  /current_setting\(\s*'app\.current_role'\s*,\s*true\s*\)\s*(?:=\s*'teacher'|IN\s*\([^)]*'teacher'[^)]*\))/gi;
const MANAGED = /managed_student_ids/i;

/** Remove `--` line comments and block comments, leaving quoted text alone. */
export function stripComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const quoted = readQuoted(sql, i);
    if (quoted) {
      out += quoted;
      i += quoted.length;
    } else if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
    } else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

/** Return the single-quoted or dollar-quoted literal starting at `i`, or null. */
function readQuoted(sql, i) {
  if (sql[i] === "'") {
    let j = i + 1;
    while (j < sql.length) {
      if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
      else if (sql[j] === "'") return sql.slice(i, j + 1);
      else j += 1;
    }
    return sql.slice(i);
  }
  const tag = sql[i] === "$" ? /^\$[A-Za-z_]*\$/.exec(sql.slice(i)) : null;
  if (!tag) return null;
  const end = sql.indexOf(tag[0], i + tag[0].length);
  return end === -1 ? sql.slice(i) : sql.slice(i, end + tag[0].length);
}

/** Split a comment-free script on top-level semicolons. */
export function splitStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  while (i < sql.length) {
    const quoted = readQuoted(sql, i);
    if (quoted) {
      current += quoted;
      i += quoted.length;
    } else if (sql[i] === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      i += 1;
    } else {
      current += sql[i];
      i += 1;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** Index of the parenthesis that closes the one opened at `open`. */
function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const quoted = readQuoted(text, i);
    if (quoted) {
      i += quoted.length - 1;
    } else if (text[i] === "(") {
      depth += 1;
    } else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The parenthesized body after a top-level keyword such as USING or WITH CHECK. */
function clauseBody(rest, keyword) {
  const match = new RegExp(`\\b${keyword}\\s*\\(`, "i").exec(rest);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  return rest.slice(open + 1, closingParen(rest, open)).trim();
}

const IDENT = String.raw`"?([A-Za-z_][A-Za-z0-9_]*)"?`;
const CREATE_RE = new RegExp(String.raw`^CREATE\s+POLICY\s+${IDENT}\s+ON\s+(?:${IDENT}\.)?${IDENT}([\s\S]*)$`, "i");
const DROP_RE = new RegExp(String.raw`^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?${IDENT}\s+ON\s+(?:${IDENT}\.)?${IDENT}`, "i");

/** Parse one statement into a policy event, or null if it is not one. */
export function parsePolicyStatement(statement) {
  const drop = DROP_RE.exec(statement);
  if (drop) return { kind: "drop", name: drop[1], table: drop[3] };
  const create = CREATE_RE.exec(statement);
  if (!create) return null;
  const [, name, , table, rest] = create;
  const usingIdx = rest.search(/\bUSING\s*\(/i);
  const head = usingIdx === -1 ? rest : rest.slice(0, usingIdx);
  const command = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(head)?.[1].toUpperCase() ?? "ALL";
  const mode = /\bAS\s+RESTRICTIVE\b/i.test(head) ? "restrictive" : "permissive";
  return {
    kind: "create",
    name,
    table,
    command,
    mode,
    using: clauseBody(rest, "USING"),
    withCheck: clauseBody(rest, "WITH\\s+CHECK"),
  };
}

/** Replay migrations in folder order; return the live policies keyed by table and name. */
export function replayMigrations(migrations) {
  const live = new Map();
  const ordered = [...migrations].sort((a, b) => a.folder.localeCompare(b.folder));
  for (const { folder, sql } of ordered) {
    for (const statement of splitStatements(stripComments(sql))) {
      const event = parsePolicyStatement(statement);
      if (!event) continue;
      const key = `${event.table}::${event.name}`;
      if (event.kind === "drop") live.delete(key);
      else live.set(key, { ...event, folder });
    }
  }
  return live;
}

/** Split an expression on a top-level keyword (OR / AND), ignoring nested parens and quotes. */
export function splitTopLevel(expr, keyword) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const re = new RegExp(`^\\s${keyword}\\s`, "i");
  for (let i = 0; i < expr.length; i += 1) {
    const quoted = readQuoted(expr, i);
    if (quoted) {
      i += quoted.length - 1;
    } else if (expr[i] === "(") {
      depth += 1;
    } else if (expr[i] === ")") {
      depth -= 1;
    } else if (depth === 0 && re.test(expr.slice(i, i + keyword.length + 2))) {
      parts.push(expr.slice(start, i).trim());
      start = i + keyword.length + 1;
    }
  }
  parts.push(expr.slice(start).trim());
  return parts.filter(Boolean);
}

/** Drop one layer of wrapping parentheses when they enclose the whole expression. */
function unwrap(expr) {
  const t = expr.trim();
  if (t.startsWith("(") && closingParen(t, 0) === t.length - 1) return unwrap(t.slice(1, -1));
  return t;
}

/** True when every OR path through `expr` calls managed_student_ids. */
export function requiresManaged(expr) {
  const body = unwrap(expr);
  const terms = splitTopLevel(body, "OR");
  if (terms.length > 1) return terms.every(requiresManaged);
  const conjuncts = splitTopLevel(body, "AND");
  if (conjuncts.length > 1) return conjuncts.some(requiresManaged);
  return MANAGED.test(body) && !/\bELSE\s+true\b/i.test(body);
}

/** The innermost parenthesized group (or the whole expression) that contains [from, to). */
function enclosingGroup(expr, from, to) {
  let best = expr;
  for (let i = 0; i < from; i += 1) {
    if (expr[i] !== "(") continue;
    const close = closingParen(expr, i);
    if (close >= to) best = expr.slice(i + 1, close);
  }
  return best;
}

/** Teacher arms in one expression, each classified as none or partial (or null when it is scoped). */
export function teacherArms(expr) {
  if (!expr) return [];
  const arms = new Map();
  for (const match of expr.matchAll(TEACHER_CHECK)) {
    const group = enclosingGroup(expr, match.index, match.index + match[0].length);
    const arm = splitTopLevel(group, "OR").find((term) => term.includes(match[0])) ?? group;
    if (requiresManaged(arm)) continue;
    const text = arm.replace(/\s+/g, " ");
    arms.set(text, { arm: text, scope: MANAGED.test(arm) ? "partial" : "none" });
  }
  return [...arms.values()];
}

function accessFor(command, clause) {
  if (clause === "WITH CHECK") return "write";
  if (command === "SELECT") return "read";
  if (command === "ALL") return "read/write";
  return "write";
}

/** Rows for every live policy whose teacher arm bypasses managed_student_ids. */
export function findUnscopedBranches(live) {
  const rows = [];
  for (const policy of live.values()) {
    for (const [clause, expr] of [["USING", policy.using], ["WITH CHECK", policy.withCheck]]) {
      for (const { arm, scope } of teacherArms(expr)) {
        rows.push({
          table: policy.table, policy: policy.name, mode: policy.mode, command: policy.command,
          clause, access: accessFor(policy.command, clause), scope, arm, folder: policy.folder,
        });
      }
    }
  }
  return rows.sort((a, b) => `${a.table}${a.policy}${a.clause}`.localeCompare(`${b.table}${b.policy}${b.clause}`));
}

function loadMigrations(root) {
  const dir = join(root, "prisma", "migrations");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "migration.sql")))
    .map((entry) => ({ folder: entry.name, sql: readFileSync(join(dir, entry.name, "migration.sql"), "utf8") }));
}

function toMarkdown(rows) {
  const clip = (s) => (s.length > 140 ? `${s.slice(0, 137)}...` : s).replace(/\|/g, "\\|");
  const lines = [
    "| Table | Policy | Mode | Command | Clause | Access | Scope | Teacher arm |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.table} | ${r.policy} | ${r.mode} | ${r.command} | ${r.clause} | ${r.access} | ${r.scope} | \`${clip(r.arm)}\` |`),
  ];
  return `${lines.join("\n")}\n\n${rows.length} branches.\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  process.stdout.write(toMarkdown(findUnscopedBranches(replayMigrations(loadMigrations(root)))));
}
