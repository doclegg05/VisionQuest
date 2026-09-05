/**
 * `--self-test` support for suite scorers.
 *
 * Every suite must be exercisable standalone, before (and independently of)
 * the runner:
 *
 *     node scripts/bench/suites/<name>.mjs --self-test
 *
 * Add exactly one line to the bottom of a scorer to get it:
 *
 *     await selfTest(import.meta.url, run);
 *
 * The call is inert unless the module is the process entry point AND
 * `--self-test` is on the command line, so importing the scorer (from the
 * runner, or from a unit test) never triggers it.
 *
 * It finds the suite config whose `scorer` points at the calling file, loads
 * that suite's fixture, builds the same `ctx` the runner builds, runs the
 * scorer, and prints the metrics. A thrown scorer exits 1; an unmet
 * `requires` exits 0 with a note, matching the runner's skip behaviour.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverSuites } from "./discover.mjs";
import { isMainModule } from "./entry.mjs";
import { checkRequires, describeUnmet, resolveEnv } from "./env.mjs";
import { describeHost } from "./host.mjs";

function repoRootFromEnv(env = process.env) {
  return env.BENCH_REPO_ROOT ? resolve(env.BENCH_REPO_ROOT) : resolve(import.meta.dirname, "..", "..", "..");
}

/**
 * True when this module's caller is the entry point and asked for a
 * self-test. Entry detection goes through isMainModule, which resolves
 * argv[1] symlinks — comparing raw paths fails open through a link and exits
 * 0 having done nothing.
 */
export function isSelfTestRun(scorerUrl, argv = process.argv) {
  if (!isMainModule(scorerUrl, argv)) return false;
  return argv.includes("--self-test");
}

/**
 * @param {string} scorerUrl `import.meta.url` of the scorer
 * @param {(ctx: any) => Promise<{metrics: any[]}>} run the scorer's run export
 */
export async function selfTest(scorerUrl, run) {
  const scorerPath = fileURLToPath(scorerUrl);
  if (!isMainModule(scorerUrl)) return;
  if (!process.argv.includes("--self-test")) {
    console.error(`Nothing to do. Run it with --self-test:\n  node ${process.argv[1]} --self-test`);
    return;
  }

  const repoRoot = repoRootFromEnv();
  const { suites } = discoverSuites({ repoRoot });
  const suite = suites.find(
    (candidate) => resolve(repoRoot, candidate.config.scorer ?? "") === scorerPath
  );
  if (!suite) {
    console.error(
      `self-test: no config/benchmarks/*.json names this scorer (${scorerPath}). ` +
        "Add the config first — a scorer without one is not a benchmark."
    );
    process.exit(1);
  }

  const config = suite.config;
  const requirements = checkRequires(config.requires, process.env);
  if (!requirements.met) {
    console.log(`SKIPPED ${config.suite}: ${describeUnmet(requirements)}`);
    process.exit(0);
  }

  let fixture = null;
  let fixturePath = null;
  if (typeof config.fixture === "string" && config.fixture.length > 0) {
    fixturePath = resolve(repoRoot, config.fixture);
    if (config.fixture.endsWith(".json") && existsSync(fixturePath)) {
      fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    }
  }

  const ctx = {
    suite: config.suite,
    config,
    fixture,
    fixturePath,
    env: resolveEnv(process.env),
    log: (...args) => console.error(`  [${config.suite}] ${args.join(" ")}`),
    now: () => new Date(),
    repoRoot,
    commit: null,
    host: describeHost(),
  };

  try {
    const output = await run(ctx);
    if (!output || !Array.isArray(output.metrics)) {
      throw new Error("run(ctx) must resolve to { metrics: [...] }");
    }
    console.log(`SELF-TEST ${config.suite} (${config.tier})`);
    for (const metric of output.metrics) {
      const declared = (config.metrics ?? []).find((m) => m.id === metric.id);
      const floor = declared && typeof declared.floor === "number" ? ` floor=${declared.floor}` : "";
      console.log(`  ${metric.id} = ${metric.value}${metric.n !== undefined ? ` (n=${metric.n})` : ""}${floor}`);
    }
    const declaredIds = (config.metrics ?? []).map((m) => m.id);
    const missing = declaredIds.filter((id) => !output.metrics.some((m) => m.id === id));
    if (missing.length > 0) {
      console.error(`  missing declared metric(s): ${missing.join(", ")}`);
      process.exit(1);
    }
    process.exit(0);
  } catch (error) {
    console.error(`SELF-TEST FAILED ${config.suite}: ${error?.stack ?? error}`);
    process.exit(1);
  }
}
