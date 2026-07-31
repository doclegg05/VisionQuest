#!/usr/bin/env node
/**
 * Dependency audit gate with a DATED allowlist — `npm run audit:deps`.
 *
 * Replaces a bare `npm audit --audit-level=high` in CI. Same strictness, but a
 * specific advisory can be waived with a written reason and an expiry date, so
 * one unfixable finding cannot force the whole gate to be turned down.
 *
 * Fails when:
 *   - a high advisory is not in config/audit-allowlist.json
 *   - a waiver has expired, or has no reason, or a malformed expiry
 *   - any critical advisory exists (never waivable)
 *   - a high advisory carries no resolvable GHSA id (cannot be matched → fails closed)
 *
 * Passes, with warnings, when:
 *   - every high advisory is covered by a live waiver
 *   - a waiver matches nothing (reported as stale; a fixed advisory must not
 *     break the build, but the entry should be deleted)
 *
 * Decision logic lives in src/lib/audit-allowlist.ts and is unit-tested there;
 * this file only shells out to npm and prints. Exit 0 = PASS, 1 = FAIL.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateAudit, type AllowlistEntry } from "../src/lib/audit-allowlist";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = join(ROOT, "config", "audit-allowlist.json");
const WARN_SOON_DAYS = 21;

function loadAllowlist(): AllowlistEntry[] | null {
  try {
    const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
    return Array.isArray(parsed.allow) ? (parsed.allow as AllowlistEntry[]) : [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`audit:deps — cannot read ${ALLOWLIST_PATH}: ${msg}`);
    process.exitCode = 1;
    return null;
  }
}

function runNpmAudit() {
  // `npm audit` exits non-zero whenever vulnerabilities exist, so the exit code
  // is not the signal — the JSON body is. Only a missing/unparseable body is an
  // actual failure to audit.
  const res = spawnSync("npm", ["audit", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const raw = res.stdout?.trim();
  if (!raw) {
    console.error("audit:deps — npm audit produced no output");
    if (res.stderr) console.error(res.stderr.split("\n").slice(-8).join("\n"));
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error("audit:deps — npm audit output was not valid JSON");
    console.error(raw.slice(0, 400));
    return null;
  }
}

function main() {
  const allowlist = loadAllowlist();
  if (allowlist === null) return;

  const report = runNpmAudit();
  if (report === null) {
    process.exitCode = 1;
    return;
  }

  const counts = report.metadata?.vulnerabilities ?? {};
  console.log("audit:deps — npm audit + dated allowlist");
  console.log(
    `  advisories: critical=${counts.critical ?? 0} high=${counts.high ?? 0} ` +
      `moderate=${counts.moderate ?? 0} low=${counts.low ?? 0}`,
  );
  console.log(`  allowlist: ${allowlist.length} entr${allowlist.length === 1 ? "y" : "ies"} in config/audit-allowlist.json`);

  const verdict = evaluateAudit(report, allowlist, new Date());

  for (const w of verdict.waived) {
    const soon = w.daysLeft <= WARN_SOON_DAYS ? "  ← EXPIRING SOON" : "";
    console.log(`\n  WAIVED  ${w.id} — expires ${w.expires} (${w.daysLeft}d)${soon}`);
    console.log(`          ${w.title}`);
    console.log(`          reason: ${w.reason.slice(0, 220)}${w.reason.length > 220 ? "…" : ""}`);
    if (soon) {
      console.log(`          ::warning::${w.id} waiver expires in ${w.daysLeft} day(s) — re-decide it before CI starts failing`);
    }
  }

  for (const id of verdict.stale) {
    console.log(`\n  STALE   ${id} — matches no current advisory; delete this allowlist entry`);
  }

  if (!verdict.ok) {
    console.error(`\nFAIL — ${verdict.blocking.length} advisor${verdict.blocking.length === 1 ? "y" : "ies"} blocking:`);
    for (const b of verdict.blocking) {
      console.error(`  ✗ [${b.severity}] ${b.id} — ${b.why}`);
      console.error(`    ${b.title}`);
    }
    console.error(
      "\nEither fix it, or add a dated waiver to config/audit-allowlist.json with a real reason.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nPASS — no unwaived high or critical advisories.");
}

main();
