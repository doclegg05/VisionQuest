import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * File-level invariant (FERPA review Sprint 1, item 11): every module that
 * resolves an AI provider also writes an AI audit event. The accountability
 * report and the `ferpa-routing` benchmark read AuditLog, so a call site that
 * resolves a provider and never audits is invisible to the FERPA review
 * exactly where the review matters. On the unfixed tree this named seven
 * files (briefing, wager-diagnosis, tailor-application, the
 * failed-extractions route, classify-attachment, memory/extract, warmup).
 *
 * A test rather than a lint rule because the invariant spans two call sites
 * in one file, which `no-restricted-syntax` cannot express.
 *
 * `AUDIT_COVERAGE_ROOT` lets the same check run against an exported tree, so
 * the red baseline is reproducible from any commit.
 */

const ROOT = path.resolve(process.env.AUDIT_COVERAGE_ROOT ?? process.cwd(), "src");

/** The resolver itself: it is what everyone else must audit around. */
const EXEMPT = new Set(["lib/ai/provider.ts"]);

function isTestPath(relative: string): boolean {
  return (
    relative.endsWith(".test.ts") ||
    relative.endsWith(".test.tsx") ||
    relative.split(path.sep).includes("__tests__")
  );
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

export function findUnauditedResolverCallers(root = ROOT): string[] {
  const offenders: string[] = [];
  for (const file of sourceFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (isTestPath(relative) || EXEMPT.has(relative)) continue;
    const source = readFileSync(file, "utf8");
    if (!source.includes("resolveAiProvider(")) continue;
    if (!source.includes("logAiAuditEvent(")) offenders.push(relative);
  }
  return offenders.sort();
}

describe("AI audit coverage", () => {
  it("every file that calls resolveAiProvider( also calls logAiAuditEvent(", () => {
    const offenders = findUnauditedResolverCallers();
    assert.deepEqual(
      offenders,
      [],
      `These files resolve an AI provider but never write an AI audit event:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("actually scans the resolver's callers (guards against an empty glob passing vacuously)", () => {
    const callers = sourceFiles(ROOT).filter((file) => {
      const relative = path.relative(ROOT, file).split(path.sep).join("/");
      return !isTestPath(relative) && readFileSync(file, "utf8").includes("resolveAiProvider(");
    });
    assert.ok(callers.length >= 10, `expected at least 10 resolver call sites, found ${callers.length}`);
  });
});
