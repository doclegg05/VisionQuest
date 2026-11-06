/**
 * Structural guard: every SECURITY DEFINER function the migrations define
 * revokes EXECUTE from PUBLIC after its last definition.
 *
 * Postgres grants EXECUTE to PUBLIC on CREATE FUNCTION. A SECURITY DEFINER
 * function runs with its owner's rights, and the scope helpers take an
 * arbitrary user id, so any role that can reach the schema could list another
 * user's students. GRANT ... TO vq_app alone does not remove the PUBLIC grant.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");

function migrationSql(): string {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((folder) => readFileSync(join(MIGRATIONS, folder, "migration.sql"), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, "");
}

/** Each CREATE FUNCTION statement, up to the end of its dollar-quoted body and trailer. */
function securityDefinerFunctions(sql: string): Map<string, number> {
  const lastDefinition = new Map<string, number>();
  const create = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w".]+)\s*\(/gi;
  for (const match of sql.matchAll(create)) {
    const start = match.index ?? 0;
    const bodyOpen = sql.indexOf("$", start);
    const tag = sql.slice(bodyOpen).match(/^\$\w*\$/)?.[0] ?? "$$";
    const bodyClose = sql.indexOf(tag, bodyOpen + tag.length);
    const end = sql.indexOf(";", bodyClose + tag.length);
    const statement = sql.slice(start, end);
    if (!/SECURITY\s+DEFINER/i.test(statement)) continue;
    const name = match[1].replace(/"/g, "").toLowerCase();
    lastDefinition.set(name.includes(".") ? name : `visionquest.${name}`, start);
  }
  return lastDefinition;
}

function lastPublicRevoke(sql: string, name: string): number {
  const bare = name.split(".").pop() ?? name;
  const revoke = new RegExp(
    `REVOKE\\s+(?:ALL(?:\\s+PRIVILEGES)?|EXECUTE)\\s+ON\\s+FUNCTION\\s+(?:"?visionquest"?\\.)?"?${bare}"?\\s*\\([^)]*\\)\\s+FROM\\s+PUBLIC`,
    "gi",
  );
  let last = -1;
  for (const match of sql.matchAll(revoke)) last = match.index ?? last;
  return last;
}

describe("SECURITY DEFINER grants", () => {
  const sql = migrationSql();
  const functions = securityDefinerFunctions(sql);

  it("finds the scope helpers, so the parser means something", () => {
    assert.ok(functions.has("visionquest.managed_student_ids"));
    assert.ok(functions.has("visionquest.is_tree_reader"));
  });

  it("every SECURITY DEFINER function revokes PUBLIC after its last definition", () => {
    const missing = [...functions].filter(([name, at]) => lastPublicRevoke(sql, name) < at).map(([name]) => name);
    assert.deepEqual(missing.sort(), []);
  });
});
