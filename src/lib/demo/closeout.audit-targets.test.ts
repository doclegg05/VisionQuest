/**
 * Every audit target type the app writes, against the closeout's list of them
 * (readiness H10).
 *
 * The closeout refuses while a demo account's audit row names a target the
 * plan keeps (`recordsAboutOthers` in closeout.guards.ts). That rule reads the
 * target id, whatever its type, so no type can slip past it. This test keeps
 * the list in closeout.audit-targets.ts complete anyway, so a reviewer can see
 * what each type's target id holds, and so a new type is a decision someone
 * makes rather than a row nobody looked at.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { AUDIT_TARGET_TYPES } from "./closeout.audit-targets";

const SRC = path.resolve(__dirname, "../..");

/** Every source file under src/, tests and the closeout's own fixtures left out. */
function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name) || entry.name === "closeout.fixtures.ts") return [];
    return [full];
  });
}

const QUOTED = /"([A-Za-z_]+)"/g;

/** The quoted words after `targetType` on each line that sets or compares one. */
function targetTypesIn(text: string): string[] {
  return text.split("\n").flatMap((line) => {
    const at = line.search(/\btargetType\b/);
    if (at === -1) return [];
    return [...line.slice(at).matchAll(QUOTED)].map((match) => match[1]).filter((word) => word !== "targetType");
  });
}

/** Types set through a named constant, and the registry's tool namespaces, which logAuditEvent writes as the type. */
function typesFromConstants(file: string, text: string): string[] {
  const constants = [...text.matchAll(/\bAUDIT_TARGET\w* = "([A-Za-z_]+)"/g)].map((match) => match[1]);
  const namespaces = file.includes(`${path.sep}registry${path.sep}`) ? [...text.matchAll(/\bnamespace: "([A-Za-z_]+)"/g)].map((match) => match[1]) : [];
  return [...constants, ...namespaces];
}

describe("demo closeout audit target types", () => {
  const found = new Set(sourceFiles(SRC).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [...targetTypesIn(text), ...typesFromConstants(file, text)];
  }));

  it("finds the types the app writes", () => {
    for (const known of ["student", "class", "certification", "appointment", "staff_invite", "admin"]) assert.ok(found.has(known), known);
  });

  it("classifies every type the app writes", () => {
    assert.deepEqual([...found].filter((type) => !Object.hasOwn(AUDIT_TARGET_TYPES, type)).sort(), []);
  });

  it("lists no type the app no longer writes", () => {
    assert.deepEqual(Object.keys(AUDIT_TARGET_TYPES).filter((type) => !found.has(type)).sort(), []);
  });
});
