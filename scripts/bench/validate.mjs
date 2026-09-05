#!/usr/bin/env node
/**
 * bench:validate — the five-part check, wired into `pipelines:validate` and
 * so into CI on every PR.
 *
 * A benchmark is five things (design §3): fixture, scorer, baseline, floor +
 * tolerance, tier. This gate refuses a suite that is missing any of the parts
 * that can be checked statically, so "a fixture without a floor cannot be
 * merged" is enforced rather than remembered.
 *
 * What it checks, per suite:
 *   1. the config parses and its "suite" matches its filename
 *   2. the scorer file exists and exports run(ctx)
 *   3. a declared fixture exists (declaring none warns — several suites
 *      measure the repo or a seeded database rather than a committed corpus)
 *   4. every metric has a unit, a direction (unless "exact"), and — on the
 *      gate and nightly tiers — a floor or "exact": true; ids are unique
 *   5. "tier" and every "requires" value are from the contract's vocabulary,
 *      and a local-model suite (requires includes "ollama") records its host
 *
 * Filesystem-only: no database, no network, and the scorer is read as text
 * rather than imported, so nothing here can be tripped by a suite's own
 * import side effects. Prints one PASS/FAIL line per suite plus an OVERALL
 * line, in the house style of scripts/validate-*-pipeline-command.mjs. Exits
 * 1 on any error.
 */

import { resolve } from "node:path";

import { discoverSuites, loadBaseline, validateSuiteConfig } from "./lib/discover.mjs";

function repoRootFromEnv(env = process.env) {
  return env.BENCH_REPO_ROOT ? resolve(env.BENCH_REPO_ROOT) : resolve(import.meta.dirname, "..", "..");
}

function main() {
  const repoRoot = repoRootFromEnv();

  let baseline = {};
  const structural = [];
  try {
    baseline = loadBaseline(repoRoot);
  } catch (error) {
    structural.push(error.message);
  }

  const { suites, errors: discoveryErrors } = discoverSuites({ repoRoot });
  structural.push(...discoveryErrors);

  const lines = [];
  let failed = structural.length;

  for (const error of structural) {
    lines.push(`FAIL  ${error}`);
  }

  for (const suite of suites) {
    const { errors, warnings } = validateSuiteConfig(suite.config, {
      path: suite.path,
      repoRoot,
      baseline,
    });
    if (errors.length === 0) {
      lines.push(`PASS  ${suite.name} (${suite.config.tier}) — ${suite.path}`);
    } else {
      failed += 1;
      lines.push(`FAIL  ${suite.name} — ${suite.path}`);
      for (const error of errors) lines.push(`        ${error}`);
    }
    for (const warning of warnings) lines.push(`      note: ${suite.name}: ${warning}`);
  }

  for (const line of lines) console.log(line);

  const total = suites.length + structural.length;
  const passed = total - failed;
  console.log(`OVERALL: ${passed}/${total} benchmark suite(s) valid`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
